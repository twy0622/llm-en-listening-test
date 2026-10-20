"""Combinatorial scenario engine.

A static list of twenty topics produces generic dialogues. Instead we sample a
coherent situation from structured domain templates (relationship, setting, two
goals, obstacle, stakes, register) and hand the writer model concrete details.
The fingerprint makes repeats detectable across runs.
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .models import Level, PassageType, TopicCard

FIRST_NAMES = (
    "Maya",
    "Jonah",
    "Priya",
    "Ellis",
    "Noor",
    "Tomas",
    "Ruth",
    "Kai",
    "Amara",
    "Felix",
    "Sofia",
    "Dev",
    "Lena",
    "Owen",
    "Ines",
    "Marcus",
    "Hana",
    "Callum",
    "Zara",
    "Theo",
)

GENERIC_DETAILS = (
    "a twenty-minute delay",
    "a blue folder with a torn corner",
    "the 7:40 train",
    "a borrowed umbrella",
    "£18 in cash",
    "room 2B",
    "a handwritten list",
    "three boxes in the hallway",
    "a cracked phone screen",
    "Tuesday afternoon",
    "a fifteen-minute walk",
    "the second-floor noticeboard",
    "an unread email from last Friday",
    "a receipt folded in a coat pocket",
    "a neighbour's spare key",
    "a half-finished cup of tea",
)

REGISTERS = (
    "polite and cautious",
    "friendly but hurried",
    "formal and precise",
    "frustrated but controlled",
    "warm and informal",
    "neutral and transactional",
    "apologetic and indirect",
    "practical and direct",
)

MONOLOGUE_LISTENER_GOALS = (
    "the listener wants the practical facts, not a story",
    "the listener needs to know what to do next",
    "the listener is skeptical and needs a concrete reason",
    "the listener has heard a different version of events",
    "the listener is new and needs the background",
)


@dataclass(frozen=True)
class Domain:
    name: str
    relationships: tuple[str, ...]
    settings: tuple[str, ...]
    goals: tuple[str, ...]
    obstacles: tuple[str, ...]
    stakes: tuple[str, ...]
    details: tuple[str, ...]


DOMAINS: tuple[Domain, ...] = (
    Domain(
        name="workplace",
        relationships=("two colleagues", "a new employee and a team lead", "two shift workers", "a freelancer and a client"),
        settings=("an office kitchen", "a warehouse break room", "a video call before the Monday meeting", "a shared desk in a co-working space"),
        goals=("swap a shift without losing pay", "agree who owns the handover notes", "ask for a deadline extension", "explain why a project slipped"),
        obstacles=("the rota was already published", "the client changed the brief twice", "one person is covering two roles", "the shared drive is a mess"),
        stakes=("a probation review is next week", "a client payment is waiting on the handover", "the team is already short-staffed", "a weekend trip depends on the swap"),
        details=("the Monday 9:15 stand-up", "a shared spreadsheet called Handover_v3", "the team's only keycard", "a printout with three highlighted rows"),
    ),
    Domain(
        name="housing",
        relationships=("a tenant and a letting agent", "two flatmates", "a landlord and a new tenant", "neighbours in a small building"),
        settings=("a narrow hallway outside a flat", "a letting agency desk", "a shared kitchen", "a building's front steps"),
        goals=("get a repair completed before the weekend", "agree how to split a utility bill", "extend a lease by two months", "resolve a noise complaint without a formal dispute"),
        obstacles=("the landlord is away until Thursday", "the original agreement is ambiguous", "the boiler part is out of stock", "both sides kept different records"),
        stakes=("a deposit is at risk", "the flat may be re-let", "a family visit is arriving Saturday", "the next month's budget depends on it"),
        details=("a leak under the kitchen sink", "the February utility bill", "a clause on page four", "a spare key labelled 'back door'"),
    ),
    Domain(
        name="travel",
        relationships=("a traveller and a station assistant", "two friends planning a trip", "a tour guide and a guest", "a driver and a passenger"),
        settings=("a busy ticket hall", "a hostel reception at 11 p.m.", "a bus stop outside a shopping centre", "a small airport cafe"),
        goals=("rebook a missed connection", "find a cheaper route home", "change a booking without losing the deposit", "decide whether to wait for a delayed coach"),
        obstacles=("the last direct train has gone", "the booking site is down", "the replacement bus is full", "the ticket rules exclude changes"),
        stakes=("a wedding starts at noon", "the hotel is non-refundable", "someone has an early shift tomorrow", "the group has already paid in full"),
        details=("platform 4", "a reservation code beginning with QX", "a 40-minute connection", "a paper ticket folded in a passport"),
    ),
    Domain(
        name="education",
        relationships=("a student and a tutor", "two classmates", "a parent and a course adviser", "a lab partner and a project lead"),
        settings=("a library study room", "a tutor's office hour", "a corridor after class", "an online seminar waiting room"),
        goals=("request an extension on an assignment", "divide the work for a group presentation", "choose between two modules", "appeal a mark that seems inconsistent"),
        obstacles=("the submission portal closed at midnight", "one partner has not read the brief", "the modules clash on Thursday", "the marking rubric was changed"),
        stakes=("a scholarship depends on the grade", "the presentation is worth 30 percent", "a visa requires full-time enrolment", "the group's final year depends on it"),
        details=("a draft with tracked changes", "the 2,000-word limit", "a footnote on page six", "the Thursday 10 a.m. seminar"),
    ),
    Domain(
        name="retail-and-service",
        relationships=("a customer and a shop assistant", "a cafe owner and a supplier", "a customer and a delivery driver", "two staff members at a returns desk"),
        settings=("a small hardware shop", "a cafe counter before the lunch rush", "a parcel collection point", "a phone repair kiosk"),
        goals=("return an item without a receipt", "fix a wrong delivery before closing", "agree on a refund or a replacement", "trace an order that says 'delivered'"),
        obstacles=("the item was bought on sale", "the courier's photo shows the wrong door", "the model is out of stock", "the payment was made on someone else's card"),
        stakes=("a birthday is tomorrow", "the cafe opens in two hours", "a customer is threatening a public review", "the shop's monthly target is close"),
        details=("a receipt photographed on a phone", "an order number ending 4471", "a box with a dented corner", "the 30-day returns window"),
    ),
    Domain(
        name="health-admin",
        relationships=("a patient and a receptionist", "a parent and a clinic administrator", "two staff members at a front desk", "a patient and a pharmacist"),
        settings=("a clinic waiting room", "a pharmacy counter", "a telephone booking line", "a hospital admin office"),
        goals=("move an appointment to a later date", "sort out a repeat prescription", "find out whether a referral was sent", "correct a misspelled name on a record"),
        obstacles=("the next available slot is three weeks away", "the prescription was sent to another pharmacy", "the referral letter has no reference number", "the records system is being updated"),
        stakes=("medication runs out on Friday", "a work shift cannot be moved", "a school form needs a signature", "the patient is travelling next month"),
        details=("a yellow appointment card", "a reference number starting HR-", "a box of tablets with two left", "the Friday 8:30 slot"),
    ),
    Domain(
        name="transport",
        relationships=("a commuter and a bus driver", "two cyclists", "a driver and a parking attendant", "a passenger and a rideshare driver"),
        settings=("a bus stopped at a red light", "a narrow street beside roadworks", "a station car park", "a pick-up point outside a hotel"),
        goals=("find out why a route was changed", "agree who was in the right after a near miss", "challenge a parking ticket", "change a drop-off point"),
        obstacles=("the diversion signs contradict the app", "there are no cameras on that corner", "the ticket machine was out of order", "the road is closed for a market"),
        stakes=("a fine doubles after fourteen days", "someone is late for a hospital appointment", "the driver's licence has points on it", "the group has a train to catch"),
        details=("a ticket timed 8:12", "a diversion via Mill Street", "a wing mirror with a scratch", "the loading bay sign"),
    ),
    Domain(
        name="community",
        relationships=("two neighbours", "a volunteer coordinator and a new volunteer", "a local shop owner and a resident", "two members of a residents' group"),
        settings=("a community hall after a meeting", "a shared garden", "a noticeboard by the postbox", "a monthly residents' meeting"),
        goals=("organise a weekend clean-up", "share the cost of a new gate", "resolve a disagreement about parking", "find someone to run a stall"),
        obstacles=("only four people volunteered", "the council form is due Friday", "two households disagree about access", "the hall is already booked"),
        stakes=("the summer fair may be cancelled", "the gate has been broken for a month", "a delivery van blocks the entrance daily", "the group's funding depends on turnout"),
        details=("a sign-up sheet with eight names", "the third Saturday in June", "a gate with a broken hinge", "a stack of plastic chairs"),
    ),
    Domain(
        name="family-and-friends",
        relationships=("two siblings", "a parent and an adult child", "two old friends", "a couple planning a family event"),
        settings=("a kitchen after dinner", "a car on the way to a birthday", "a phone call from a train station", "a garden bench"),
        goals=("divide the cost of a present", "decide who hosts a family lunch", "explain why a plan changed", "ask for help without making it a big deal"),
        obstacles=("one person already bought something", "the kitchen is being repaired", "a work trip was moved at the last minute", "an old disagreement keeps surfacing"),
        stakes=("a parent's birthday is Sunday", "the family group chat is already tense", "a friend is moving abroad", "someone has taken time off work"),
        details=("a cake order for 14 people", "a card signed by everyone", "the Sunday 1 p.m. train", "a photo from last summer"),
    ),
    Domain(
        name="tech-support",
        relationships=("a user and a support agent", "two colleagues in different offices", "a customer and a repair technician", "a student and an IT helpdesk worker"),
        settings=("a phone support queue", "a shared office with two monitors", "a repair shop counter", "a video call with a bad connection"),
        goals=("recover access to an account", "stop a laptop from restarting", "transfer files before a deadline", "cancel a subscription that keeps charging"),
        obstacles=("two-factor codes go to an old phone", "the warranty expired last month", "the backup drive is not recognised", "the cancellation page loops back to login"),
        stakes=("a client presentation is tomorrow", "the account holds five years of photos", "a subscription renews tonight", "the repair quote is already paid"),
        details=("an error message ending 0x8007", "a silver laptop with a sticker", "a verification code sent at 9:03", "the backup folder named 2025"),
    ),
    Domain(
        name="money-and-admin",
        relationships=("a customer and a bank adviser", "two flatmates splitting bills", "a small business owner and an accountant", "a person and a subscription provider"),
        settings=("a bank branch side desk", "a kitchen table covered in envelopes", "an accountant's office", "a billing support chat"),
        goals=("reverse an unexpected charge", "agree a fair split for a shared bill", "understand why a tax payment was late", "cancel a renewal before it starts"),
        obstacles=("the charge shows a different merchant name", "one flatmate was away for half the month", "the accountant's email went to spam", "the renewal notice arrived yesterday"),
        stakes=("an overdraft fee is compounding", "a deposit is needed by Friday", "a late payment affects a loan application", "the annual price doubles next week"),
        details=("a statement with two identical charges", "a bill for £96.40", "an invoice dated 3 March", "a cancellation window of 48 hours"),
    ),
    Domain(
        name="hobbies-and-leisure",
        relationships=("two members of a club", "a coach and an adult beginner", "a librarian and a reader", "two friends planning an outing"),
        settings=("a climbing wall on a quiet morning", "a library reading room", "a community pool reception", "a cafe after a film"),
        goals=("find a beginner session that fits a schedule", "return a borrowed item without embarrassment", "choose a route for a weekend walk", "convince a friend to try a new hobby"),
        obstacles=("the beginner course is full", "the item was damaged in storage", "the forecast changes hourly", "the friend is worried about looking foolish"),
        stakes=("a membership renews next month", "a friendship has been distant lately", "a rare free weekend is approaching", "the club needs one more person to run"),
        details=("a timetable with a 6:30 session", "a guidebook with a folded map", "a borrowed racket in a black case", "a text confirming Saturday"),
    ),
    Domain(
        name="environment-and-local",
        relationships=("a council adviser and a resident", "two volunteers", "a school staff member and a parent", "a shop owner and a recycling coordinator"),
        settings=("a street corner with overflowing bins", "a school playground", "a farmers' market stall", "a council office counter"),
        goals=("get a bin collection restored", "organise a repair cafe", "reduce single-use packaging at an event", "report a blocked drain"),
        obstacles=("the route was removed in a budget review", "the venue has no storage", "suppliers already ordered the packaging", "the drain is on private land"),
        stakes=("the smell is affecting nearby shops", "the event is in three weeks", "a grant application closes soon", "the next rain may flood the path"),
        details=("a bin with a missing lid", "a map with two red crosses", "a grant form of four pages", "the Saturday market"),
    ),
    Domain(
        name="food-and-hospitality",
        relationships=("a diner and a waiter", "a chef and a supplier", "two friends splitting a restaurant bill", "an event organiser and a caterer"),
        settings=("a small restaurant near closing", "a kitchen before service", "a cafe table by the window", "a wedding venue tasting room"),
        goals=("fix a wrong order without ruining the evening", "change a delivery time", "split a bill fairly", "adjust a menu for two guests with allergies"),
        obstacles=("the kitchen has stopped taking orders", "the supplier's van broke down", "one person ordered the expensive dish", "the venue cannot guarantee a nut-free kitchen"),
        stakes=("a birthday celebration is underway", "a wedding is in two days", "a friendship is already strained", "a deposit has been paid"),
        details=("a bill with a service charge", "a delivery due at 6:15", "a menu with a crossed-out dish", "a note about a nut allergy"),
    ),
)


def _fingerprint(card: TopicCard) -> str:
    payload = "|".join(
        [
            card.kind,
            card.level,
            card.domain,
            card.relationship,
            card.setting,
            card.goal_a,
            card.goal_b,
            card.obstacle,
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def fingerprint(card: TopicCard) -> str:
    return _fingerprint(card)


class TopicStore:
    """Append-only JSONL cache used to avoid repeating scenarios."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.fingerprints: set[str] = set()
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            value = data.get("fingerprint")
            if isinstance(value, str):
                self.fingerprints.add(value)

    def add(self, card: TopicCard) -> str:
        digest = _fingerprint(card)
        if digest in self.fingerprints:
            return digest
        self.fingerprints.add(digest)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "fingerprint": digest,
            "id": card.id,
            "kind": card.kind,
            "level": card.level,
            "domain": card.domain,
            "card": card.model_dump(by_alias=True),
        }
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return digest


def build_topic_card(
    kind: PassageType,
    level: Level,
    rng: random.Random,
    *,
    domain: Domain | None = None,
) -> TopicCard:
    chosen = domain or rng.choice(DOMAINS)
    relationship = rng.choice(chosen.relationships)
    setting = rng.choice(chosen.settings)
    goal_a = rng.choice(chosen.goals)
    if kind == "monologue":
        goal_b = rng.choice(MONOLOGUE_LISTENER_GOALS)
    else:
        # Two speakers need genuinely different objectives, not a duplicate.
        alternatives = [goal for goal in chosen.goals if goal != goal_a]
        goal_b = rng.choice(alternatives or chosen.goals)
    obstacle = rng.choice(chosen.obstacles)
    stakes = rng.choice(chosen.stakes)
    register = rng.choice(REGISTERS)

    details: list[str] = []
    for candidate in rng.sample(chosen.details, k=min(2, len(chosen.details))):
        details.append(candidate)
    for candidate in rng.sample(GENERIC_DETAILS, k=2):
        details.append(candidate)
    if kind == "dialogue" and rng.random() < 0.7:
        details.append(f"the two speakers are {rng.choice(FIRST_NAMES)} and {rng.choice(FIRST_NAMES)}")
    elif kind == "monologue":
        details.append(f"the speaker's name is {rng.choice(FIRST_NAMES)}")

    # Keep detail order stable but remove accidental duplicates.
    details = list(dict.fromkeys(details))

    draft = TopicCard(
        id="top_pending",
        kind=kind,
        domain=chosen.name,
        relationship=relationship,
        setting=setting,
        goal_a=goal_a,
        goal_b=goal_b,
        obstacle=obstacle,
        stakes=stakes,
        register=register,
        level=level,
        details=details,
    )
    digest = _fingerprint(draft)
    return draft.model_copy(update={"id": f"top_{digest[:12]}"})


def generate_topic_cards(
    kind: PassageType,
    level: Level,
    count: int,
    *,
    seed: int,
    store: TopicStore | None = None,
) -> list[TopicCard]:
    rng = random.Random(seed)
    cards: list[TopicCard] = []
    attempts = 0
    while len(cards) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                "Could not find enough unique scenarios. Increase the domain pool or remove the store."
            )
        card = build_topic_card(kind, level, rng)
        if store and _fingerprint(card) in store.fingerprints:
            continue
        if any(_fingerprint(existing) == _fingerprint(card) for existing in cards):
            continue
        cards.append(card)
    return cards


def cards_json(cards: Iterable[TopicCard]) -> str:
    return json.dumps([card.model_dump(by_alias=True) for card in cards], indent=2, ensure_ascii=False)
