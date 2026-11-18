create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    name text not null unique
);

create table if not exists public.stores (
    id uuid primary key default gen_random_uuid(),
    name text not null unique
);

create table if not exists public.store_stock (
    product_id uuid not null references public.products(id) on delete restrict,
    store_id uuid not null references public.stores(id) on delete restrict,
    quantity integer not null default 0 check (quantity >= 0),
    primary key (product_id, store_id)
);

create table if not exists public.transfers (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null,
    source_store_id uuid not null,
    destination_store_id uuid not null,
    quantity integer not null check (quantity > 0),
    status text not null default 'Pending'
        check (status in ('Pending', 'In Transit', 'Received')),
    created_at timestamptz not null default now(),
    dispatched_at timestamptz,
    received_at timestamptz,
    constraint transfers_different_stores
        check (source_store_id <> destination_store_id),
    constraint transfers_source_stock_fk
        foreign key (product_id, source_store_id)
        references public.store_stock(product_id, store_id)
        on delete restrict,
    constraint transfers_destination_stock_fk
        foreign key (product_id, destination_store_id)
        references public.store_stock(product_id, store_id)
        on delete restrict,
    constraint transfers_timestamp_state_check check (
        (status = 'Pending'
            and dispatched_at is null
            and received_at is null)
        or (status = 'In Transit'
            and dispatched_at is not null
            and dispatched_at >= created_at
            and received_at is null)
        or (status = 'Received'
            and dispatched_at is not null
            and dispatched_at >= created_at
            and received_at is not null
            and received_at >= dispatched_at)
    )
);

drop function if exists public.create_transfer(uuid, uuid, uuid, integer);

create or replace function public.create_transfer(
    p_product_id uuid,
    p_source_store_id uuid,
    p_destination_store_id uuid,
    p_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_transfer_id uuid;
begin
    if p_product_id is null
        or p_source_store_id is null
        or p_destination_store_id is null then
        raise exception using
            errcode = '22023',
            message = 'Product and both stores are required';
    end if;

    if p_quantity is null
        or p_quantity <= 0
        or p_quantity <> trunc(p_quantity)
        or p_quantity > 2147483647 then
        raise exception using
            errcode = '22023',
            message = 'Quantity must be a positive whole number';
    end if;

    if p_source_store_id = p_destination_store_id then
        raise exception using
            errcode = '22023',
            message = 'Source and destination must be different';
    end if;

    insert into public.transfers (
        product_id,
        source_store_id,
        destination_store_id,
        quantity
    )
    values (
        p_product_id,
        p_source_store_id,
        p_destination_store_id,
        p_quantity::integer
    )
    returning id into v_transfer_id;

    return v_transfer_id;
end;
$$;

create or replace function public.dispatch_transfer(
    p_transfer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_transfer public.transfers%rowtype;
    v_available_quantity integer;
begin
    select *
    into v_transfer
    from public.transfers
    where id = p_transfer_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Transfer not found';
    end if;

    if v_transfer.status <> 'Pending' then
        raise exception using
            errcode = 'P0001',
            message = 'Transfer must be Pending to dispatch';
    end if;

    select quantity
    into v_available_quantity
    from public.store_stock
    where product_id = v_transfer.product_id
        and store_id = v_transfer.source_store_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0001',
            message = 'Source stock record not found';
    end if;

    if v_available_quantity < v_transfer.quantity then
        raise exception using
            errcode = 'P0001',
            message = 'Insufficient stock';
    end if;

    update public.store_stock
    set quantity = quantity - v_transfer.quantity
    where product_id = v_transfer.product_id
        and store_id = v_transfer.source_store_id;

    update public.transfers
    set status = 'In Transit',
        dispatched_at = now()
    where id = v_transfer.id;

    return v_transfer.id;
end;
$$;

create or replace function public.receive_transfer(
    p_transfer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_transfer public.transfers%rowtype;
begin
    select *
    into v_transfer
    from public.transfers
    where id = p_transfer_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Transfer not found';
    end if;

    if v_transfer.status <> 'In Transit' then
        raise exception using
            errcode = 'P0001',
            message = 'Transfer must be In Transit to receive';
    end if;

    perform 1
    from public.store_stock
    where product_id = v_transfer.product_id
        and store_id = v_transfer.destination_store_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0001',
            message = 'Destination stock record not found';
    end if;

    update public.store_stock
    set quantity = quantity + v_transfer.quantity
    where product_id = v_transfer.product_id
        and store_id = v_transfer.destination_store_id;

    update public.transfers
    set status = 'Received',
        received_at = now()
    where id = v_transfer.id;

    return v_transfer.id;
end;
$$;

alter table public.products enable row level security;
alter table public.stores enable row level security;
alter table public.store_stock enable row level security;
alter table public.transfers enable row level security;

revoke all on table
    public.products,
    public.stores,
    public.store_stock,
    public.transfers
from public, anon, authenticated, service_role;

grant select on table
    public.products,
    public.stores,
    public.store_stock,
    public.transfers
to service_role;

revoke all on function public.create_transfer(uuid, uuid, uuid, numeric)
    from public, anon, authenticated;
revoke all on function public.dispatch_transfer(uuid)
    from public, anon, authenticated;
revoke all on function public.receive_transfer(uuid)
    from public, anon, authenticated;

grant execute on function public.create_transfer(uuid, uuid, uuid, numeric)
    to service_role;
grant execute on function public.dispatch_transfer(uuid)
    to service_role;
grant execute on function public.receive_transfer(uuid)
    to service_role;