insert into public.products (name)
values ('Notebook'), ('Pen'), ('Bottle')
on conflict (name) do nothing;

insert into public.stores (name)
values ('Store A'), ('Store B')
on conflict (name) do nothing;

insert into public.store_stock (product_id, store_id, quantity)
select products.id, stores.id,
    case
        when products.name = 'Notebook' and stores.name = 'Store A' then 12
        when products.name = 'Notebook' and stores.name = 'Store B' then 3
        when products.name = 'Pen' and stores.name = 'Store A' then 20
        when products.name = 'Pen' and stores.name = 'Store B' then 8
        when products.name = 'Bottle' and stores.name = 'Store A' then 5
        else 0
    end
from public.products
cross join public.stores
where products.name in ('Notebook', 'Pen', 'Bottle')
    and stores.name in ('Store A', 'Store B')
on conflict (product_id, store_id) do nothing;