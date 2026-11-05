#!/usr/bin/env python3
"""Run five synthetic recall ratings through the official Anki headless scheduler."""

import argparse
import json
import sys
import tempfile
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CASES = ROOT / "scripts" / "evaluation" / "ai-qa-cases.json"
EXPECTED_VERSION = "25.9.5"
RECALLED = [True, False, True, True, False]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        installed_version = version("anki")
    except PackageNotFoundError:
        print("Install the pinned headless library first: python3 -m pip install --target /tmp/anki-pilot anki==25.9.5", file=sys.stderr)
        return 2
    if installed_version != EXPECTED_VERSION:
        print(f"Expected Anki headless library {EXPECTED_VERSION}; got {installed_version}.", file=sys.stderr)
        return 2

    try:
        from anki.collection import Collection
        from anki.scheduler_pb2 import CardAnswer
    except ImportError as error:
        print(f"Could not import the Anki library: {error}", file=sys.stderr)
        return 2

    suite = json.loads(args.cases.read_text(encoding="utf-8"))
    cases = [case for case in suite["cases"] if not case["caseId"].startswith("negative-")][:5]
    if len(cases) != 5:
        print("The fixed task needs five positive synthetic QA cases.", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="viendu-anki-eval-") as temporary_directory:
        collection_path = Path(temporary_directory) / "collection.anki2"
        collection = Collection(str(collection_path))
        try:
            deck = collection.decks.add_normal_deck_with_name("Viendu synthetic packet")
            collection.decks.select(deck.id)
            model = collection.models.by_name("Basic")
            for index, case in enumerate(cases, start=1):
                note = collection.new_note(model)
                note.fields = [case["item"]["stem"], case["item"]["explanation"]]
                collection.add_note(note, deck.id)

            config = collection.decks.config_dict_for_deck_id(deck.id)
            scheduled = []
            ratings = [CardAnswer.GOOD if recalled else CardAnswer.AGAIN for recalled in RECALLED]
            for rating in ratings:
                card = collection.sched.getCard()
                if card is None:
                    raise RuntimeError("Anki returned fewer queued cards than expected.")
                states = collection._backend.get_scheduling_states(card.id)
                answer = collection.sched.build_answer(card=card, states=states, rating=rating)
                collection.sched.answer_card(answer)
                scheduled.append({"cardProcessed": True, "rating": "good" if rating == CardAnswer.GOOD else "again"})
            output = {
                "benchmark": "fixed-synthetic-functional-tasks",
                "tool": "Anki Python headless library",
                "version": installed_version,
                "desktopUiUsed": False,
                "schedulerVersion": collection.conf["schedVer"],
                "deck": {
                    "name": "Viendu synthetic packet",
                    "newStepsMinutes": config["new"]["delays"],
                    "newCardsPerDay": config["new"]["perDay"],
                    "reviewsPerDay": config["rev"]["perDay"],
                    "maxAnswerTimeSeconds": config["maxTaken"],
                    "desiredRetention": config["desiredRetention"],
                    "fsrsWeightsConfigured": bool(config["fsrsWeights"]),
                },
                "tasks": {
                    "cardsAdded": len(cases),
                    "cardsAnswered": len(scheduled),
                    "cardsRemainingInLearningQueue": collection.sched.get_queued_cards().learning_count,
                    "errors": 0,
                    "ratingVector": [row["rating"] for row in scheduled],
                    "commonAssessment": {"score": sum(RECALLED), "total": len(RECALLED)},
                    "elapsedStudyMinutes": 0,
                },
                "note": "Synthetic scheduler operations through the official headless library; no Anki desktop UI or learner behavior measured.",
            }
            serialized = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
            if args.output:
                args.output.write_text(serialized, encoding="utf-8")
            print(serialized, end="")
            return 0 if len(scheduled) == 5 else 1
        finally:
            collection.close()


if __name__ == "__main__":
    raise SystemExit(main())
