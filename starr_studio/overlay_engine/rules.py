"""Which elements a title gets, with its text filled in (docs/plans/overlay-engine.md, section 3.6)."""

import time
from typing import Any

from pydantic import TypeAdapter

from .facts import TitleFacts
from .style import OPTION_REF, PLACEHOLDER, Element, Style

_ELEMENT = TypeAdapter(Element)


def resolve(style: Style, facts: TitleFacts, values: dict | None = None, now: int | None = None) -> list[Element]:
    """The style's elements for this title, ready to draw: options and placeholders filled, hidden elements gone."""
    now = int(time.time()) if now is None else now
    options = style.option_values(values)
    # a percent option stands for its fraction wherever a style uses it as $name
    refs = {name: options[name] / 100 if option.type == "percent" else options[name] for name, option in style.options.items()}
    elements = [_resolve(e.model_dump(), facts, options, refs, now) for e in style.elements]
    return [_ELEMENT.validate_python(e) for e in elements if e is not None]


def _substitute(value: Any, refs: dict) -> Any:
    if isinstance(value, dict):
        return {k: _substitute(v, refs) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute(v, refs) for v in value]
    if isinstance(value, str) and (m := OPTION_REF.match(value)):
        return refs[m.group(1)]
    return value


def _resolve(element: dict, facts: TitleFacts, options: dict, refs: dict, now: int) -> dict | None:
    element = _substitute(element, refs)
    show_when = element.pop("show_when")
    if show_when is not None and not matches(show_when, facts, options, now):
        return None
    element["show_when"] = None
    if "children" in element:
        element["children"] = [c for child in element["children"] if (c := _resolve(child, facts, options, refs, now))]
        return element if element["children"] else None
    if element["type"] == "text":
        names = PLACEHOLDER.findall(element["text"])
        texts = {name: placeholder_text(name, facts) for name in names}
        if None in texts.values():
            return None
        element["text"] = PLACEHOLDER.sub(lambda m: texts[m.group(1)], element["text"])
    return element


def placeholder_text(name: str, facts: TitleFacts) -> str | None:
    """What one placeholder shows; None if the fact is missing."""
    if name in ("imdb", "tmdb"):
        return None if getattr(facts, name) is None else f"{getattr(facts, name):.1f}"
    if name in ("rt_critic", "rt_audience", "year"):
        return None if getattr(facts, name) is None else str(getattr(facts, name))
    if name == "runtime":
        if facts.runtime_minutes is None:
            return None
        hours, minutes = divmod(facts.runtime_minutes, 60)
        return " ".join(part for part in (f"{hours}h" if hours else "", f"{minutes}m" if minutes or not hours else "") if part)
    if name == "audio":
        if facts.audio_codec is None:
            return None
        special = "DTS:X" if facts.dts_x else f"{facts.audio_codec} ATMOS" if facts.atmos else facts.audio_codec
        return f"{special} {facts.channels}" if facts.channels else special
    return getattr(facts, name)


def _equals(fact: Any, value: Any) -> bool:
    if isinstance(fact, str) and isinstance(value, str):
        return fact.casefold() == value.casefold()
    return fact == value


def _fact_matches(fact: Any, want: Any) -> bool:
    if fact is None:
        return False
    if isinstance(want, dict):
        return fact >= want.get("min", fact) and fact <= want.get("max", fact)
    if isinstance(want, list):
        return any(_equals(fact, w) for w in want)
    return _equals(fact, want)


def matches(rule: dict, facts: TitleFacts, values: dict, now: int) -> bool:
    """show_when: every key of the mapping must hold (see style.check_show_when)."""
    for key, want in rule.items():
        if key == "any":
            ok = any(matches(r, facts, values, now) for r in want)
        elif key == "all":
            ok = all(matches(r, facts, values, now) for r in want)
        elif key == "not":
            ok = not matches(want, facts, values, now)
        elif key == "has":
            ok = all(getattr(facts, n) is not None and getattr(facts, n) is not False for n in (want if isinstance(want, list) else [want]))  # `in (None, False)` would treat a 0 score as missing
        elif key == "added_within_days":
            ok = want > 0 and facts.added_at is not None and now - facts.added_at <= want * 86400
        elif key == "option":
            ok = all(value in values[name] if isinstance(values[name], list) else values[name] == value for name, value in want.items())
        else:
            ok = _fact_matches(getattr(facts, key), want)
        if not ok:
            return False
    return True
