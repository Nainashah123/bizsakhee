# The BizSakhi Handbook

Two guides. The first is for whoever operates BizSakhi as a business. The second
is for the women who sign up and use it.

Credentials are **not** in this file — they live in `ACCESS.local.md`, which is
gitignored and never pushed.

---

# Part one — running BizSakhi

## What you are selling

BizSakhi is a business operating system for women who sell through WhatsApp,
Instagram and word of mouth. The pitch is not "a CRM". It is: **stop losing
orders in your chat history.**

Your customer is a boutique owner, home baker, jewellery seller, mehendi artist,
tutor or reseller running a real business from a phone. She already has
customers. What she lacks is one place where the customer, the order, the
payment and the follow-up all live together.

## What each seller gets

| Area       | What it does for her                                                    |
| ---------- | ----------------------------------------------------------------------- |
| Overview   | Sales this month, money still to collect, follow-ups due, new enquiries |
| Customers  | Every buyer with phone, city, tags, notes and full history              |
| Follow-ups | Tasks with due dates, so "I'll confirm tomorrow" gets chased            |
| Orders     | Line items, discount, tax, shipping, payments, printable invoice        |
| Pipeline   | Enquiries moving from first message to confirmed order                  |
| Products   | Catalogue with photos, prices, variants, draft or published             |
| AI helper  | Drafts a reply or caption in her language; she edits and sends          |
| Channels   | WhatsApp / Instagram connection (needs a Meta app)                      |
| Billing    | Her plan, usage, upgrade, payment method                                |

## Pricing

Free is real, not a trial — it is how someone tries the product without talking
to you. Limits are enforced on the server; nobody can exceed them from a
browser.

| Plan    | Price       | Seats | Customers | Products   | AI drafts     |
| ------- | ----------- | ----- | --------- | ---------- | ------------- |
| Free    | ₹0          | 1     | 50        | 10         | 20 / month    |
| Starter | ₹299 / mo   | 1     | 500       | 100        | 200 / month   |
| Growth  | ₹699 / mo   | 3     | 5,000     | 500        | 1,000 / month |
| Pro     | ₹1,499 / mo | 10    | 25,000    | Unlimited¹ | 5,000 / month |

¹ Under fair use. Growth and Pro also unlock automations and the WhatsApp /
Instagram channel connection.

**Downgrades never delete anything.** A seller over the new limit keeps every
record and simply cannot create more until she upgrades or archives. Archived
customers and products do not count toward limits, so archiving is a genuine way
to make room.

## What is ready, and what is not

| Capability                                        | State          | Needs                              |
| ------------------------------------------------- | -------------- | ---------------------------------- |
| Accounts and sign-in                              | Live           | —                                  |
| Customers, orders, payments, follow-ups, products | Live           | —                                  |
| Public catalogue and invoice links                | Live           | —                                  |
| Taking money                                      | Setup required | Stripe keys + 3 price IDs          |
| AI helper                                         | Setup required | Anthropic or Vercel AI Gateway key |
| WhatsApp / Instagram inbox                        | Setup required | Meta app + Meta review             |
| Daily follow-up reminders                         | Setup required | `CRON_SECRET`                      |

Anything not configured shows an honest "Setup required" screen with a
checklist. Nothing anywhere claims to be connected when it is not.

WhatsApp **links** work regardless: every customer has a one-tap "message on
WhatsApp" button that opens a real chat, with no Meta app at all.

> **Before selling to anyone, connect Stripe.** Until then there is no way for a
> seller to pay you.

## Signing up your first sellers

There is no invite system to run. Send the link; she signs up herself.

1. **Send her the link.** She opens it on her phone and taps "Start free".
2. **She confirms her email.** One tap.
3. **She answers three short screens.** Name, business, how she sells.
4. **Tell her to add one real customer** — not to explore the menus. One
   customer, one follow-up. The value lands immediately or not at all.
5. **Check in after a week.** If she has added a second customer unprompted, she
   has adopted it. If not, ask what got in the way.

## The admin area

`/admin` is the operator view. It is a different axis from workspace roles: an
Owner is powerful inside one business and blind to every other, while a platform
admin sees across all of them.

| Page             | Shows                                                |
| ---------------- | ---------------------------------------------------- |
| `/admin`         | Businesses, paying count, active count, plan split   |
| `/admin/sellers` | Every business: owner, city, plan, counts, join date |

Three deliberate properties:

- **Not writable from a browser.** `platform_admins` has RLS on with no policy
  for signed-in users and privileges revoked, so membership can only be granted
  through the service role or direct database access. A seller cannot make
  herself an operator.
- **404, not 403.** Everyone else — including signed-in sellers — gets a 404. A
  "forbidden" page would confirm the area exists.
- **Audited.** Every cross-business read is written to `audit_logs` with the
  operator's identity.

**Customer message bodies are deliberately absent from the admin area.** Sellers'
customers never consented to that, and knowing who signed up, who is paying and
who is stuck does not require it.

To add another operator, see `ACCESS.local.md` §4.

## Supporting a seller

| She says                           | What is happening                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| "I can't sign in."                 | Point her at "Forgot password". Wrong password and unknown email give the same message on purpose, so nobody can discover who has an account. |
| "My customer's number won't save." | She already has that customer. `+91 98765 43210` and `09876543210` are matched as the same person.                                            |
| "My catalogue link shows nothing." | Two switches: the product must be **Published**, and Settings → **Public catalogue** must be on.                                              |
| "I hit my limit."                  | Upgrade, or archive what she is no longer selling.                                                                                            |

---

# Part two — using BizSakhi

_Written for the seller. Send it to her, or paste any section into WhatsApp._

## What it is for

You already have customers. They message you on WhatsApp and Instagram, ask for
prices, promise to confirm tomorrow, and some of them owe you money. BizSakhi is
where all of that lives, so you stop scrolling through chats to find it.

It works on your phone. You do not need a computer, and you do not move your
customers anywhere — you keep talking to them exactly where you already do.

## Getting started

1. **Sign up.** Name, email, and a password of at least 10 characters. Tap the
   eye icon to check what you typed.
2. **Confirm your email.** Open the link we send.
3. **Answer three screens.** Who you are, what your business is, where enquiries
   come from. All of it can be changed later.
4. **Add your most recent customer** — a real person you spoke to this week.
5. **Give yourself one follow-up** you actually need to do tomorrow. Then close
   the app and let it remind you.

## Your day, in the app

### Overview

Open this first: what you sold this month, what is still unpaid, what is due
today, what is overdue. Empty at the start — it fills as you use everything else.

### Customers

Everyone who ever asked you about anything. A name and a phone number is enough.

- Type a number however you like. `+91 98765 43210` and `09876543210` are stored
  as the same person, so you never get duplicates.
- Every customer has a **Message on WhatsApp** button that opens the chat with
  her number filled in.
- **Tags** for how you actually think: "bridal", "repeat", "wholesale".
- **Notes** for what you would otherwise forget — her daughter's wedding date,
  that she always wants cash on delivery.
- Opening a customer shows her whole history: notes, orders, follow-ups and
  messages in one list.

Moving from a spreadsheet? **Import CSV** shows exactly what will be added, what
looks wrong, and who is already in your list — _before_ anything is saved.

### Follow-ups

The screen that makes you money. Every "I'll let you know tomorrow" becomes a
follow-up with a date, grouped into **Due today**, **Overdue** and **Upcoming**,
worked out in your own timezone.

### Orders

Build an order from a customer. Add products from your catalogue or type a
one-off line. Enter discount, tax and delivery — the total is calculated for
you, so you never do sums in your head at 11pm.

- Record **part payments**. Pay ₹2,000 of ₹5,000 and the order shows ₹3,000
  still to collect.
- Every order has a **printable invoice**.
- Share an invoice with a private link. Only someone you send it to can open it,
  and you can revoke it at any time.

### Pipeline

For enquiries that are not orders yet: new enquiry, in conversation, quote sent,
confirmed. Move a card with the **Move to stage** menu — no dragging on a phone.

### Products

Your catalogue: name, price, photos, and variants like sizes or colours. Sale
prices are supported.

Products stay **Draft** until you publish them, so you can prepare a new
collection privately. Drafts are never visible to anyone outside your business.

### Sharing your catalogue

Settings → turn on **Public catalogue**. You get a link for your Instagram bio or
WhatsApp status. Every product has its own enquiry button that opens a WhatsApp
chat with you.

> **Two switches, not one.** Nothing appears publicly unless the product is
> **Published** _and_ **Public catalogue** is on. If your link looks empty, one
> of those is off.

### AI helper

For when you know what to say but not how to write it.

- **Smart Reply** — paste what your customer wrote, pick a tone and language,
  get a reply you can edit.
- **Marketing content** — pick a product, get a caption, hook, hashtags and a
  shorter WhatsApp version.

Works in English, Hindi, Hinglish, Marathi, Gujarati, Tamil, Telugu, Bengali,
Kannada, Malayalam and Punjabi.

**Nothing is sent for you.** The AI only writes a draft on your screen. It cannot
message your customers. You read it, change what does not sound like you, and
send it yourself. It will not invent a price or delivery date you did not give
it.

## Working with someone else

| Role   | Can do                                                                     |
| ------ | -------------------------------------------------------------------------- |
| Owner  | Everything, including billing and closing the business account             |
| Admin  | Everything day to day — customers, orders, products, settings. Not billing |
| Member | Customers, orders and follow-ups only                                      |

You are the Owner of your business. Nobody outside it can see your customers.

## Your plan

Free covers 50 customers, 10 products and 20 AI drafts a month — enough to
decide whether this is for you. Paid plans start at ₹299 a month.

Moving to a smaller plan **deletes nothing.** You keep everything; you just
cannot add more until you upgrade or archive what you no longer sell.

## Is my data private?

- Your customers are yours. No other business on BizSakhi can see them — enforced
  by the database itself, not just the screens, and covered by tests that
  actively try to break it.
- Draft products and unpublished catalogues are never public.
- Invoice links are impossible to guess and can be revoked.
- Your customers' messages are never used to train anything.

## If something goes wrong

| Problem                         | Fix                                                               |
| ------------------------------- | ----------------------------------------------------------------- |
| Forgot your password            | "Forgot password" on the sign-in screen                           |
| "Customer already exists"       | She does — search her name; the number matched one you saved      |
| Catalogue link is empty         | Check the product is Published **and** Public catalogue is on     |
| Something says "Setup required" | That part is not connected yet; the rest of the app is unaffected |
