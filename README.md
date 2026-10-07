# Uni Map

**An interactive map for shortlisting universities abroad for a Master's or PhD, and for checking whether part-time work can pay for it.**

It was built for international students (particularly from Nepal), for whom the real question isn't only "which university?" but "can I afford it?". Each university is a pin on a map. Each course shows its international tuition, living costs, the deposit and scholarships open to Nepali students. You enter the jobs you expect to do while studying, and the map shows which courses your earnings would cover.

> **Current scope: United Kingdom 🇬🇧**: 105 universities · 330 courses (Master's + PhD), currently in Computer Science, AI, HCI/UX, health & public health, nursing, development economics & finance, and sustainable & green finance.
> More countries and subjects are planned; see [Future scope](#future-scope).

---

## Features

**🗺️ Map and filters**
Filter by level (Master's / PhD), subject, city and radius, QS world ranking, maximum total cost, sure (automatic) scholarships, placement years, January/spring intakes, outside London, and more. Click a university for its courses, costs, Google photos and reviews, and links to the course pages.

**💼 Budget & work calculator**
Add one or more jobs, each with its own pay rate, hours per week and weeks per year. For example, a 20 h/week term-time job plus a full-time summer job. Earnings are added up and taxed using UK rules (20% income tax + 8% National Insurance above £12,570). For every course the calculator shows:
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
- **Visa work limits:** UK student visas normally allow up to 20 hours a week in term time. The calculator warns when your jobs add up to more.
- Rankings are CUG 2027 (UK) and QS 2027 (world). Six universities added recently (Roehampton, Cranfield, Canterbury Christ Church, Suffolk, Bath Spa, Bucks New) don't have rankings, placements or scholarships checked yet, and show "Not checked".

---

## Future scope

The UK is the first country. The plan is to cover the main study destinations, each with its own fees, living costs, scholarships and work and tax rules:

| Country | Status |
|---|---|
| 🇬🇧 United Kingdom | ✅ Available |
| 🇺🇸 United States | Planned |
| 🇨🇦 Canada | Planned |
| 🇦🇺 Australia | Planned |
| 🇩🇪 Germany | Planned |
| 🌍 Other countries (Ireland, the Netherlands and more) | Future |

Each new country will bring the same features: map pins, filters, the budget & work calculator with that country's tax and student-visa work limits, and live fee refresh where university sites allow it.

Courses will keep widening to other subjects, so the map can be used for any field of study.
