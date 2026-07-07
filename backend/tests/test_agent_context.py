from unittest import TestCase

from backend.agents.action_types import START_QUIZ_WITH_GOAL, START_ROLEPLAY_WITH_SITUATION
from backend.agents.context import build_rule_based_suggestions, normalize_learning_preference


class AgentOpeningCopyTest(TestCase):
    def test_normalizes_existing_awkward_memory_summary(self):
        summary = normalize_learning_preference("비즈니스 주제 보다 일상 회화 중심으로 우선 학습학습")

        self.assertEqual(summary, "일상 회화 중심 학습")

    def test_memory_and_due_words_create_clean_opening(self):
        result = build_rule_based_suggestions({
            "learning": {
                "due_review_count": 39,
                "weak_words": [{"word": "materialize"}, {"word": "sequence"}],
            },
            "due_words": [
                {"word": "materialize"},
                {"word": "potassium"},
                {"word": "sequence"},
                {"word": "assessed"},
                {"word": "epic"},
            ],
            "tag_counts": [{"name": "뉴스", "count": 8}],
            "memories": {
                "learning_preferences": {
                    "summaries": ["비즈니스 주제 보다 일상 회화 중심으로 우선 학습학습"],
                },
            },
        })

        self.assertEqual(
            result["message"],
            "일상 회화 중심 학습 선호를 반영했어요. 오늘은 복습 예정 단어 39개를 먼저 짧게 점검해 보세요.",
        )
        self.assertEqual([card["title"] for card in result["cards"]], ["복습 예정 39개", "#뉴스 회화 연습", "약점 단어"])
        self.assertNotIn("학습학습", result["message"])
        self.assertEqual(result["cards"][0]["payload"]["action"]["type"], START_QUIZ_WITH_GOAL)
        self.assertEqual(result["cards"][1]["payload"]["action"]["type"], START_ROLEPLAY_WITH_SITUATION)

    def test_memory_only_does_not_create_memory_card(self):
        result = build_rule_based_suggestions({
            "learning": {},
            "due_words": [],
            "tag_counts": [],
            "memories": {"learning_preferences": {"notes": ["일상 회화를 우선 연습하고 싶어"]}},
        })

        self.assertEqual(result["message"], "일상 회화 연습 선호를 반영했어요. 오늘 학습은 이 방향에 맞춰 추천할게요.")
        self.assertEqual(result["cards"], [])

    def test_due_words_keep_quiz_action_without_memory(self):
        result = build_rule_based_suggestions({
            "learning": {"due_review_count": 2},
            "due_words": [{"word": "apple"}, {"word": "banana"}],
            "tag_counts": [],
            "memories": {},
        })

        self.assertEqual(result["message"], "복습 예정 단어가 2개 있어요. 먼저 짧은 퀴즈로 점검해 보세요.")
        self.assertEqual(result["actions"][0]["type"], START_QUIZ_WITH_GOAL)
        self.assertEqual(result["cards"][0]["payload"]["action"]["type"], START_QUIZ_WITH_GOAL)

    def test_tag_only_keeps_roleplay_action(self):
        result = build_rule_based_suggestions({
            "learning": {},
            "due_words": [],
            "tag_counts": [{"name": "여행", "count": 4}],
            "memories": {},
        })

        self.assertEqual(result["message"], "복습 예정 단어는 없지만, 단어장 태그로 회화 연습을 만들 수 있어요.")
        self.assertEqual(result["cards"][0]["title"], "#여행 회화 연습")
        self.assertEqual(result["actions"][0]["type"], START_ROLEPLAY_WITH_SITUATION)
