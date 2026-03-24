import unittest

from langchain_core.documents import Document

from youtube_rag import (
    _parse_sections_payload,
    build_timestamp_url,
    extract_timestamp_seconds,
    extract_video_id,
    format_timestamp,
)


class YouTubeRagHelpersTest(unittest.TestCase):
    def test_extract_video_id_from_watch_url(self) -> None:
        video_id = extract_video_id(
            "https://www.youtube.com/watch?v=HEfHFsfGXjs&t=32s"
        )
        self.assertEqual(video_id, "HEfHFsfGXjs")

    def test_extract_video_id_from_shorts_url(self) -> None:
        video_id = extract_video_id("https://www.youtube.com/shorts/HEfHFsfGXjs")
        self.assertEqual(video_id, "HEfHFsfGXjs")

    def test_extract_timestamp_seconds_supports_minutes(self) -> None:
        self.assertEqual(extract_timestamp_seconds("what happens at 2:35?"), 155)

    def test_extract_timestamp_seconds_supports_hours(self) -> None:
        self.assertEqual(
            extract_timestamp_seconds("jump to 01:02:03 in the video"),
            3723,
        )

    def test_format_timestamp(self) -> None:
        self.assertEqual(format_timestamp(155), "02:35")
        self.assertEqual(format_timestamp(3723), "01:02:03")

    def test_build_timestamp_url(self) -> None:
        self.assertEqual(
            build_timestamp_url("HEfHFsfGXjs", 155),
            "https://www.youtube.com/watch?v=HEfHFsfGXjs&t=155s",
        )

    def test_parse_sections_payload(self) -> None:
        chunks = [
            Document(
                page_content="Intro to the problem.",
                metadata={
                    "start": 0,
                    "end": 90,
                    "source": build_timestamp_url("HEfHFsfGXjs", 0),
                },
            ),
            Document(
                page_content="Main explanation.",
                metadata={
                    "start": 90,
                    "end": 180,
                    "source": build_timestamp_url("HEfHFsfGXjs", 90),
                },
            ),
        ]
        payload = """
        {
          "sections": [
            {
              "title": "Opening setup",
              "summary": "The speaker introduces the main question.",
              "start": 0,
              "end": 90
            },
            {
              "title": "Core explanation",
              "summary": "The speaker develops the key idea in detail.",
              "start": 90,
              "end": 180
            }
          ]
        }
        """

        sections = _parse_sections_payload("HEfHFsfGXjs", chunks, payload)

        self.assertEqual(len(sections), 2)
        self.assertEqual(sections[0].title, "Opening setup")
        self.assertEqual(sections[1].start, 90)


if __name__ == "__main__":
    unittest.main()
