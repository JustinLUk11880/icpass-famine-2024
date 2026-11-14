# LifeMon passport

Web app for the Famine24 LifeMon game. Each group (about 12-14 people) plays as
two teams, e.g. group 1 is teams 1.1 and 1.2, and each team shares one
passport with its own profile. Helpers at each station make a QR code; any
member of the team scans it and the team's money, apples, happiness and degree
update on every member's phone at once. The leaderboard adds a group's two
teams together.

Live site: https://famine-ace23.web.app · helper page: `/helper` · scoreboard: `/result`

## First-time setup

Two files are gitignored and must be created from their templates:

```bash
cp src/database/firebase.example.js src/database/firebase.js          # paste your Firebase web config
cp src/components/secret/Secret.example.js src/components/secret/Secret.js  # set a secret
```

In the Firebase console, enable **Authentication → Sign-in method → Anonymous**.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Dev server on http://localhost:3000 |
| `npm run build` | Production build into `build/` |
| `npm run test:game` | Rules-engine tests: every number in the rules document, plus a 200k-scan fuzz. Safe, offline. |
| `npm run test:live` | Tests against the real Firestore project: concurrency, limits, rules, load. **Resets the game - never run during an event.** |
| `firebase deploy --only hosting,firestore:rules` | Publish the site and the security rules |

## Running the event

**Before the event:** on `/helper` → Groups, set *Number of groups* (default
10), then press *Reset game*. Optionally *Create groups in advance* to roll
every group's random starting profile now.

**Joining:** each participant opens the site and picks their group, then their
team (e.g. 1.1 or 1.2). The first member of a team to join rolls that team's
starting profile, per the rules: 0–3 apples, 5 happiness, $100–300 and a degree
(none 50% / Primary 30% / Secondary 20%). Each passport also shows the whole
group's total.

**At a station:** on `/helper` → Station QR, choose the stage and station,
then fill in the result. The QR only appears once every choice is made, and
the page shows what the group will get and what they need. **Each group can
scan a QR code once** - press *New QR for the next group* when the same group
comes back (gym sets, another police shift). Codes expire after 2 minutes.

**Live events tab:** send an announcement to every phone (e.g. when the
robbery starts), and apply *Pandemic Pass-26* or the *ICPASS Tax* to every
group. Each group is hit once even if the button is pressed twice.

- **The Final Will (15:40):** *Open voting* puts a voting card on every
  passport. Each group has one vote (any member can change it until voting
  closes) and cannot vote for itself. *Close voting*, check the tally (ties are
  flagged - break them with a wheel), type the room and press *Announce
  winner*: every phone shows the winner and the room. From then on only the
  winning group can scan the Final Will QR, so make it in that room.
- **Pay out marriages (end of LifeMon):** every married couple gets pot x 2
  and +10 apples each. Pays each marriage once.

**Groups tab:** every group's stats, the PhD / assassin / Final Will places
taken, marriages with their pots, the donation box, *Fix a mistake / award a
prize* (also how to pay raffle prizes, and *Clear cooldowns* to let a group
replay a station), the raffle draw weighted by tickets, and a log of every scan.

## The rules, as implemented

All game logic is in [`src/game/`](src/game): [`catalog.js`](src/game/catalog.js)
lists every station, [`engine.js`](src/game/engine.js) applies them. Both are
pure JavaScript shared by the app and the tests. Numbers come from the
stations table; where the helper guide disagrees, the table wins (see the
comment at the top of `catalog.js`).

- **Degrees:** No degree → Primary → Secondary → University → PhD. Each exam
  needs the previous degree; Primary / Secondary / University jobs need that
  degree. Exam fees are paid whether the group passes or fails.
- **Apples are capped at 8.** Money and happiness have no cap.
- **Costs vs penalties:** a group that cannot afford a cost (exam fee, sauna,
  raffle, a job's apple) is refused. Penalties (prisoner's dilemma, banker loss,
  casino loss, divorce, pandemic) are always applied and stop at 0.
- **Once only:** Teacher, Artist, gym membership. **Event-wide limits:** PhD 2
  groups, Assassin 1, The Final Will 1.
- **Cooldowns, per group and per station, losses included:** 15 minutes for
  every game except entertainment; food delivery 20 minutes; marriage bank
  deposits 30 minutes. No cooldown on penalties (prisoner), shopping, the
  robbery rewards, food waste, wedding or divorce. The passport shows "X again
  in N min" so a helper can check before the group plays.
- **University jobs** (surgeon, banker, lawyer): win +$350, lose -$50, and the
  work costs 1 apple either way. Engineer: win +$500, 1 apple either way.
- **Robbery** only for groups under $500; the police who stop it scan
  *Police: stopped the robbery* (+$500).
- **Teams:** every station rule (cooldowns, once-only, limits, robbery under
  $500, marriages, Pandemic and Tax) applies per team. Teams of the same group
  cannot marry each other. The Final Will vote is one vote per group; either
  team of the winning group can scan the prize QR (the first scan takes it).
- **Entertainment** (casino, raffle, sauna): +2 happiness each time.
- **Supermarket (no cooldowns):** buy apples at the helper's current price
  ($50-$200), refused if the team cannot hold them; donate apples into a
  shared box (+2 happiness); receive from the box only if the team has under
  $200. The box starts with 50 apples after every reset.
- **Wedding and bank:** both teams scan the same wedding QR (free, +5 happiness
  each). Each team
  then deposits $100-$500 into the shared pot, secretly, every 30 minutes.
  Divorce: the group that scans gets pot x 1.5, -3 happiness, -10 apples; the
  other group gets +3 happiness, +10 apples. At the end, *Pay out marriages*.
- **Stations the documents leave blank** (bottle bowling, hospital): the helper
  enters the amounts on the day.
- **Awards:** the leaderboard ranks Monopoly (money), Joy Master (happiness)
  and Wellness King/Queen (apples) separately. Raffle tickets are never shown
  to other groups.

## How a scan stays correct when a whole group scans at once

Every scan is one Firestore transaction that reads the group, the QR's
redemption record and any limit or marriage it touches, then decides and
writes. Simultaneous scans are serialised by Firestore, so they cannot spend
the same apple twice. The redemption record `redemptions/{qr}_{group}` makes
each QR usable once per group. [`firestore.rules`](firestore.rules) refuses
any negative stat, more than 8 apples or a degree above PhD, whatever a client
sends.

The QR signing secret ships in the browser bundle, so a determined player
could forge a code. The rules cap the damage; they cannot prevent it.
