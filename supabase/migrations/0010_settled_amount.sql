-- What somebody actually settled for.
--
-- A share is a moving target while a bill is open. An item is divided by however
-- many people have claimed it *so far*, so the third and fourth person to tap a
-- shared dish halve what the first two owe. Anyone who paid in between paid a
-- figure that was true when they saw it and is not true any more.
--
-- Settling recorded only *that* somebody paid, never *what*. So the difference
-- was invisible: the payer's screen showed "Paid" beside a due figure that no
-- longer had anything to do with the transfer, and the guest was told "nothing
-- more to do" while being fifty ringgit up. A false settled is the worst thing
-- this product can say, and it was saying it quietly.
--
-- One column closes it. It is also not specific to the divisor -- editing an
-- item's price after somebody paid drifts exactly the same way.

alter table public.participants
  add column settled_amount_sen integer
    check (settled_amount_sen is null or settled_amount_sen >= 0);

comment on column public.participants.settled_amount_sen is
  'What this person settled for, in sen. Null when unknown: either not settled, '
  'or settled before this column existed. Never inferred after the fact -- the '
  'whole point is that the figure at the time cannot be recomputed later.';

-- Guests read participants through a column allowlist rather than `select *`,
-- so a new column is invisible to them until it is named here. The guest needs
-- this one to be told about their own overpayment.
grant select (settled_amount_sen) on public.participants to anon;
