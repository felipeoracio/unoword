from copy import deepcopy

import pytest
from lib.writing_document import clean_document, markdown, plain_text


def document(attrs):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "New writing", "marks": [
            {"type": "sessionCredit", "attrs": attrs}, {"type": "bold"}
        ]}
    ]}]}


def test_credit_survives_save_without_changing_text_or_export():
    content = document({"session": "1234-abcd", "kind": "typed"})
    assert clean_document(deepcopy(content)) == content
    assert plain_text(content) == "New writing"
    assert markdown(content).strip() == "**New writing**"


@pytest.mark.parametrize("attrs", [None, [], "bad", {"session": "x", "kind": []},
    {"session": "x" * 65, "kind": "typed"},
    {"session": "<script>", "kind": "typed"},
    {"session": "x", "kind": "unknown"}])
def test_invalid_credit_is_discarded(attrs):
    cleaned = clean_document(document(attrs))
    assert cleaned["content"][0]["content"][0]["marks"] == [{"type": "bold"}]
