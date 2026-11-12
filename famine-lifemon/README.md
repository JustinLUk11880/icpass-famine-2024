# LifeMon passport

Web app for the Famine24 LifeMon game. Each group shares one passport. Helpers
at each station make a QR code; any member of the group scans it and the
group's money, apples, happiness and degree update on every member's phone at
once.

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

**Before the event:** on `/helper` → Groups, press *Reset game*. Optionally
*Create groups in advance* to roll every group's random starting profile now.

**Joining:** each participant opens the site and picks their group. The first
member to join rolls the group's starting profile, per the rules: 0–3 apples,
5 happiness, $100–300 and a degree (none 50% / Primary 30% / Secondary 20%).

**At a station:** on `/helper` → Station QR, choose the stage and station,
then fill in the result. The QR only appears once every choice is made, and
the page shows what the group will get and what they need. **Each group can
scan a QR code once** - press *New QR for the next group* when the same group
comes back (gym sets, another police shift). Codes expire after 2 minutes.

**Live events tab:** send an announcement to every phone (e.g. when the
robbery starts), and apply *Pandemic Pass-26* or the *ICPASS Tax* to every
group. Each group is hit once even if the button is pressed twice.

**Groups tab:** every group's stats, the PhD / assassin / Final Will places
taken, *Fix a mistake / award a prize* (also how to pay raffle prizes), the
raffle draw weighted by tickets, and a log of every scan.

## The rules, as implemented

All game logic is in [`src/game/`](src/game): [`catalog.js`](src/game/catalog.js)
lists every station, [`engine.js`](src/game/engine.js) applies them. Both are
pure JavaScript shared by the app and the tests.

- **Degrees:** No degree → Primary → Secondary → University → PhD. Each exam
  needs the previous degree; Primary / Secondary / University jobs need that
  degree. Exam fees are paid whether the group passes or fails.
- **Apples are capped at 8.** Money and happiness have no cap.
- **Costs vs penalties:** a group that cannot afford a cost (exam fee, sauna,
  raffle, a job's apple) is refused. Penalties (prisoner's dilemma, banker loss,
  casino loss, divorce, pandemic) are always applied and stop at 0.
- **Once only:** Teacher, Artist, gym membership. **Event-wide limits:** PhD 2
  groups, Assassin 1, The Final Will 1. **Cooldown:** food delivery once per 20
  minutes per group, losses included.
- **Robbery** only for groups under $500. **Wedding:** both groups scan the same
  QR; divorce frees both.
- **Stations the rules document leaves blank** (Nurse, Surgeon, Lawyer,
  Engineer, Drug, Food bank, Supermarket, Hospital, Bank, Wedding, Divorce):
  the helper enters the amounts on the day; the degree requirement still applies.
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
