# Uni Map

**An interactive map for shortlisting universities abroad for a Master's or PhD, and for checking whether part-time work can pay for it.**

It was built for international students (particularly from Nepal), for whom the real question isn't only "which university?" but "can I afford it?". Each university is a pin on a map. Each course shows its international tuition, living costs, the deposit and scholarships open to Nepali students. You enter the jobs you expect to do while studying, and the map shows which courses your earnings would cover.

> **Current scope: United Kingdom 🇬🇧 and Germany 🇩🇪** (switch with the country picker)
> - **UK:** 108 universities · 414 courses (Master's + PhD) in Computer Science, AI, HCI/UX, health & public health, nursing, international development & NGO management, development economics & finance, and sustainable & green finance.
> - **Germany:** 74 universities · 151 English-taught master's in the same subjects, from DAAD's International Programmes database, with fees in euros, German work rules and the blocked-account requirement.
> More countries and subjects are planned; see [Future scope](#future-scope).

---

## Features

**🗺️ Map and filters**
Filter by level (Master's / PhD), subject, city and radius, QS world ranking, maximum total cost, sure (automatic) scholarships, placement years, January/spring intakes, outside London, and more. Click a university for its courses, costs, Google photos and reviews, and links to the course pages.

**💼 Budget & work calculator**
Add one or more jobs, each with its own pay rate, hours per week and weeks per year. For example, a 20 h/week term-time job plus a full-time summer job. Earnings are added up and taxed using the selected country's rules: in the UK, 20% income tax + 8% National Insurance above £12,570; in Germany, roughly 9.3% pension contribution above the €603/month mini-job limit and income tax above €12,348. For every course the calculator shows:
- the pre-CAS deposit you'd need from savings
- the remaining fee + 12 months' living that work has to cover
- your yearly surplus or deficit, and the hourly rate you'd need to break even

**📅 Budget planner for enrolled students**
Already enrolled? **Budget planner** opens a planner where you enter your university, fee, scholarship and what you've already paid, the dates and amounts of the installments you still owe, your monthly costs (rent, food, transport, bills, misc and anything else), and your jobs with their hours, rates and the months they run. It projects your money month by month and tells you, in numbers, a chart and plain words:
- your monthly surplus or deficit after living costs
- whether each installment is covered on its due date, and by how much you'd be short
- when you'd run out of money, and how much extra income (or spending cut) would close the gap

**🟢🔴 Affordability at a glance**
Each pin has a ring: **green** if your jobs cover that university, **red** if you'd be short, or split when only some of its courses are covered. Grouped pins show how many universities in the group are covered and how many aren't.

**🔄 Live fees**
**Refresh fees** re-reads the current international fee from each university's own course page and shows what changed, with a link to the source for every figure.

**📊 Data table**
Every course in one sortable table with per-column filters. You can override the hourly rate per course to try out scenarios.

**✨ Glass interface**
A frosted-glass UI floating over the map, with light/dark themes and adjustable window transparency and blur. It works on phones too.

---

## Good to know

- **Figures are estimates for shortlisting, not quotes.** Always confirm fees, deposits and scholarship rules on the university's own website before applying.
- **PhD fees are estimated** (≈85% of the same university's Master's fee). PhD funding is usually competitive studentships.
- **Live refresh can't read every site.** Some universities block automated access (e.g. UCL, Oxford, Cardiff) and some don't publish fees on the course page (e.g. KCL, Warwick). Those courses keep their stored figure, and the refresh report says which is which.
- **Visa work limits:** UK student visas normally allow up to 20 hours a week in term time; German student visas allow 140 full or 280 half days a year, at most 20 hours a week during lectures. The calculator warns when your jobs add up to more.
- **Germany:** most public universities charge only a semester fee (≈€100–400); Baden-Württemberg charges non-EU students €1,500 a semester and TUM €4,000–6,000. Living costs are at least the €11,904 a year a student visa needs in a blocked account. Only Germany's top 10 universities have QS 2027 positions checked; the rest show "Not checked". The budget planner page is UK-only for now.
- Rankings are CUG 2027 (UK) and QS 2027 (world). Six universities added recently (Roehampton, Cranfield, Canterbury Christ Church, Suffolk, Bath Spa, Bucks New) don't have rankings, placements or scholarships checked yet, and show "Not checked".

---

## Future scope

The UK and Germany are available. The plan is to cover the main study destinations, each with its own fees, living costs, scholarships and work and tax rules:

| Country | Status |
|---|---|
| 🇬🇧 United Kingdom | ✅ Available |
| 🇩🇪 Germany | ✅ Available |
| 🇺🇸 United States | Planned |
| 🇨🇦 Canada | Planned |
| 🇦🇺 Australia | Planned |
| 🌍 Other countries (Ireland, the Netherlands and more) | Future |

Each new country will bring the same features: map pins, filters, the budget & work calculator with that country's tax and student-visa work limits, and live fee refresh where university sites allow it.

Courses will keep widening to other subjects, so the map can be used for any field of study.
