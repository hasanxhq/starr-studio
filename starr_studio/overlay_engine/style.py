"""The style file format, version 1 (docs/plans/overlay-engine.md, section 3.6).

A style is YAML: options a library can change, and elements drawn on the poster. Lengths are poster units (the poster
is 1000 wide and 1500 high) or "N%" of the poster's width (x, width) or height (y, height). Any value may be "$name",
an option; text may hold {placeholders} (facts.PLACEHOLDERS); show_when decides whether an element is drawn.

rules.resolve() turns a style plus one title's facts into the same models with every $option and {placeholder}
filled and every hidden element gone (a row, column or group left with no children goes too); render.py draws only
such resolved styles.

Sizes: a text's box is as wide as its shaped text and as tall as the font's capital letters at that size (descenders
hang below it), plus its background's padding; a logo is `height` tall and as wide as its image's shape; a row is as
wide as its children and gaps and as tall as its tallest child, a column the other way round. Text and logos centre
their capitals or image in that box.
"""

import re
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from ruamel.yaml import YAML

from .facts import FACT_NAMES, PLACEHOLDERS
from .fonts import FONTS

POSTER_WIDTH, POSTER_HEIGHT = 1000, 1500
LOGOS = frozenset({"imdb", "rt_fresh", "rt_rotten", "rt_audience_upright", "rt_audience_spilled", "tmdb"})  # logos/<name>.png

OPTION_REF = re.compile(r"^\$([a-z][a-z0-9_]*)$")
PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
COLOUR = re.compile(r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
PERCENT = re.compile(r"^-?\d+(?:\.\d+)?%$")

Length = float | str  # poster units, "N%", or "$option"
Number = float | str  # a number, or "$option"
Colour = str  # "#RRGGBB", "#RRGGBBAA", or "$option"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_default=True)


def _check_length(value: Any) -> Any:
    if isinstance(value, str) and not (OPTION_REF.match(value) or PERCENT.match(value)):
        raise ValueError(f"{value!r} isn't a number, a percentage like '17%', or an $option")
    return value


def _check_number(value: Any) -> Any:
    if isinstance(value, str) and not OPTION_REF.match(value):
        raise ValueError(f"{value!r} isn't a number or an $option")
    return value


def _check_colour(value: Any) -> Any:
    if value is not None and not (COLOUR.match(value) or OPTION_REF.match(value)):
        raise ValueError(f"{value!r} isn't a colour like '#E50914' or '#00000099', or an $option")
    return value


class Box(Strict):
    """Where an element sits. Horizontally: left, right, both (the width stretches), or centre_x (an offset from the
    centre, 0 = centred). Vertically the same with top, bottom and centre_y. width and height are optional where the
    content gives a size (text, logo, row, column)."""

    left: Length | None = None
    right: Length | None = None
    centre_x: Length | None = None
    top: Length | None = None
    bottom: Length | None = None
    centre_y: Length | None = None
    width: Length | None = None
    height: Length | None = None

    _lengths = field_validator("left", "right", "centre_x", "top", "bottom", "centre_y", "width", "height")(classmethod(lambda cls, v: _check_length(v)))

    @model_validator(mode="after")
    def _anchors(self):
        if self.centre_x is not None and (self.left is not None or self.right is not None):
            raise ValueError("centre_x can't go with left or right")
        if self.centre_y is not None and (self.top is not None or self.bottom is not None):
            raise ValueError("centre_y can't go with top or bottom")
        if self.left is None and self.right is None and self.centre_x is None:
            raise ValueError("needs left, right or centre_x")
        if self.top is None and self.bottom is None and self.centre_y is None:
            raise ValueError("needs top, bottom or centre_y")
        if self.left is not None and self.right is not None and self.width is not None:
            raise ValueError("left and right already set the width")
        if self.top is not None and self.bottom is not None and self.height is not None:
            raise ValueError("top and bottom already set the height")
        return self


class Stop(Strict):
    at: float = Field(ge=0, le=1)  # 0 = where the gradient starts, 1 = where it ends
    colour: Colour
    opacity: Number = 1

    _c = field_validator("colour")(classmethod(lambda cls, v: _check_colour(v)))
    _n = field_validator("opacity")(classmethod(lambda cls, v: _check_number(v)))


class Gradient(Strict):
    direction: Literal["down", "up", "right", "left"] = "down"  # the way the stops run
    stops: list[Stop] = Field(min_length=2)


class Fill(Strict):
    """A flat colour, or a gradient."""

    colour: Colour | None = None
    opacity: Number = 1
    gradient: Gradient | None = None

    _c = field_validator("colour")(classmethod(lambda cls, v: _check_colour(v)))
    _n = field_validator("opacity")(classmethod(lambda cls, v: _check_number(v)))

    @model_validator(mode="after")
    def _one(self):
        if (self.colour is None) == (self.gradient is None):
            raise ValueError("give a colour or a gradient")
        return self


class Stroke(Strict):
    colour: Colour
    width: Number
    opacity: Number = 1

    _c = field_validator("colour")(classmethod(lambda cls, v: _check_colour(v)))
    _n = field_validator("width", "opacity")(classmethod(lambda cls, v: _check_number(v)))


Padding = Number | list[Number]  # all sides; [vertical, horizontal]; or [top, right, bottom, left]


class Background(Strict):
    """A box drawn behind a text's own size plus padding: a filled pill, or an outline with no fill."""

    fill: Fill | None = None
    stroke: Stroke | None = None
    radius: Number = 0
    padding: Padding = 0

    _n = field_validator("radius")(classmethod(lambda cls, v: _check_number(v)))

    @field_validator("padding")
    @classmethod
    def _padding(cls, v):
        if isinstance(v, list) and len(v) not in (2, 4):
            raise ValueError("padding is one number, [vertical, horizontal] or [top, right, bottom, left]")
        for part in v if isinstance(v, list) else [v]:
            _check_number(part)
        return v


class Shadow(Strict):
    dx: Number = 0
    dy: Number = 4
    blur: Number = 6  # the blur's standard deviation, in poster units
    colour: Colour = "#000000"
    opacity: Number = 0.5

    _c = field_validator("colour")(classmethod(lambda cls, v: _check_colour(v)))
    _n = field_validator("dx", "dy", "blur", "opacity")(classmethod(lambda cls, v: _check_number(v)))


class BlurBehind(Strict):
    """Frosted glass: the poster under the element's background, blurred and tinted."""

    radius: Number = 12  # blur standard deviation, in poster units
    tint: Colour = "#0E0E12"
    tint_opacity: Number = 0.4

    _c = field_validator("tint")(classmethod(lambda cls, v: _check_colour(v)))
    _n = field_validator("radius", "tint_opacity")(classmethod(lambda cls, v: _check_number(v)))


class ElementBase(Strict):
    id: str | None = None
    box: Box | None = None  # required at the top level and in a group; a row or column places its children itself
    show_when: dict[str, Any] | None = None  # see check_show_when
    opacity: Number = 1
    shadow: Shadow | None = None
    blur_behind: BlurBehind | None = None

    _n = field_validator("opacity")(classmethod(lambda cls, v: _check_number(v)))


class Rect(ElementBase):
    type: Literal["rect"]
    fill: Fill | None = None
    stroke: Stroke | None = None
    radius: Number = 0

    _n2 = field_validator("radius")(classmethod(lambda cls, v: _check_number(v)))


class Text(ElementBase):
    type: Literal["text"]
    text: str
    font: str = "Inter Bold"
    size: Number
    colour: Colour = "#FFFFFF"
    letter_spacing: Number = 0  # poster units added between letters
    background: Background | None = None

    _c = field_validator("colour")(classmethod(lambda cls, v: _check_colour(v)))
    _n2 = field_validator("size", "letter_spacing")(classmethod(lambda cls, v: _check_number(v)))

    @field_validator("font")
    @classmethod
    def _font(cls, v):
        if v not in FONTS and not OPTION_REF.match(v):
            raise ValueError(f"unknown font {v!r}; fonts: {', '.join(FONTS)}")
        return v

    @field_validator("text")
    @classmethod
    def _placeholders(cls, v):
        unknown = sorted(set(PLACEHOLDER.findall(v)) - set(PLACEHOLDERS))
        if unknown:
            raise ValueError(f"unknown placeholder(s) {', '.join('{' + u + '}' for u in unknown)}")
        return v


class Logo(ElementBase):
    type: Literal["logo"]
    image: str  # a shipped logo (LOGOS) or an $option
    height: Number  # the width follows the image's shape

    _n2 = field_validator("height")(classmethod(lambda cls, v: _check_number(v)))

    @field_validator("image")
    @classmethod
    def _image(cls, v):
        if v not in LOGOS and not OPTION_REF.match(v):
            raise ValueError(f"unknown logo {v!r}; logos: {', '.join(sorted(LOGOS))}")
        return v


class Svg(ElementBase):
    """Power users' escape hatch: a raw SVG fragment in a width × height box (checked against an allow-list when drawn)."""

    type: Literal["svg"]
    svg: str
    width: Number
    height: Number

    _n2 = field_validator("width", "height")(classmethod(lambda cls, v: _check_number(v)))


class Row(ElementBase):
    """Children left to right with gap between them; hidden children close up. align is on the cross axis."""

    type: Literal["row"]
    gap: Number = 0
    align: Literal["start", "centre", "end"] = "centre"
    children: list["Element"] = Field(min_length=1)

    _n2 = field_validator("gap")(classmethod(lambda cls, v: _check_number(v)))


class Column(ElementBase):
    """Children top to bottom with gap between them; hidden children close up. align is on the cross axis."""

    type: Literal["column"]
    gap: Number = 0
    align: Literal["start", "centre", "end"] = "start"
    children: list["Element"] = Field(min_length=1)

    _n2 = field_validator("gap")(classmethod(lambda cls, v: _check_number(v)))


class Group(ElementBase):
    """Children placed by their own boxes, inside the group's box."""

    type: Literal["group"]
    children: list["Element"] = Field(min_length=1)


Element = Annotated[Union[Rect, Text, Logo, Svg, Row, Column, Group], Field(discriminator="type")]
for _model in (Row, Column, Group):
    _model.model_rebuild()


class Option(Strict):
    """Something a library can change without editing the file. A percent option is 0–100 in the UI and the
    library's settings; where a style uses it ($name) it stands for the fraction (65 → 0.65)."""

    type: Literal["colour", "percent", "number", "choice", "toggle", "text"]
    label: str
    default: Any
    min: float | None = None
    max: float | None = None
    choices: list[str] | None = None
    multiple: bool = False

    @model_validator(mode="after")
    def _default(self):
        self.check(self.default)
        if self.type == "choice" and not self.choices:
            raise ValueError("a choice option needs choices")
        return self

    def check(self, value: Any) -> Any:
        """The value, if it suits this option; ValueError if not."""
        if self.type == "colour":
            if not isinstance(value, str) or not COLOUR.match(value):
                raise ValueError(f"{value!r} isn't a colour like '#E50914'")
        elif self.type in ("percent", "number"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{value!r} isn't a number")
            low, high = (0, 100) if self.type == "percent" else (self.min, self.max)
            if (low is not None and value < low) or (high is not None and value > high):
                raise ValueError(f"{value} is outside {low}–{high}")
        elif self.type == "toggle":
            if not isinstance(value, bool):
                raise ValueError(f"{value!r} isn't true or false")
        elif self.type == "text":
            if not isinstance(value, str):
                raise ValueError(f"{value!r} isn't text")
        elif self.type == "choice":
            picked = value if self.multiple else [value]
            if not isinstance(picked, list) or any(v not in (self.choices or []) for v in picked):
                raise ValueError(f"{value!r} isn't among {self.choices}")
        return value


class Style(Strict):
    studio_style: Literal[1]
    name: str = Field(min_length=1)
    description: str = ""
    canvas: Literal["poster"] = "poster"
    options: dict[str, Option] = Field(default_factory=dict)
    elements: list[Element] = Field(min_length=1)

    @field_validator("options")
    @classmethod
    def _option_names(cls, v):
        for name in v:
            if not OPTION_REF.match(f"${name}"):
                raise ValueError(f"option name {name!r}: use lower case letters, digits and _")
        return v

    @model_validator(mode="after")
    def _whole(self):
        for element in self.elements:
            if element.box is None:
                raise ValueError(f"top-level element {element.id or element.type!r} needs a box")
        _walk(self.elements, self.options, inside=None)
        return self

    def option_values(self, values: dict[str, Any] | None = None) -> dict[str, Any]:
        """Every option's value: the library's where it set one (checked), otherwise the default."""
        values = values or {}
        unknown = set(values) - set(self.options)
        if unknown:
            raise ValueError(f"unknown option(s): {', '.join(sorted(unknown))}")
        return {name: option.check(values[name]) if name in values else option.default for name, option in self.options.items()}


def _walk(elements: list, options: dict[str, Option], inside: str | None) -> None:
    for element in elements:
        where = element.id or element.type
        if inside == "group" and element.box is None:
            raise ValueError(f"{where!r} is in a group, so it needs a box")
        if inside in ("row", "column") and element.box is not None:
            raise ValueError(f"{where!r} is in a {inside}, which places it: leave its box out")
        if element.show_when is not None:
            check_show_when(element.show_when, options, where)
        _check_refs(element.model_dump(exclude={"show_when", "children"}), options, where)
        if isinstance(element, (Row, Column, Group)):
            _walk(element.children, options, element.type)


def _check_refs(value: Any, options: dict[str, Option], where: str) -> None:
    if isinstance(value, dict):
        for v in value.values():
            _check_refs(v, options, where)
    elif isinstance(value, list):
        for v in value:
            _check_refs(v, options, where)
    elif isinstance(value, str) and (m := OPTION_REF.match(value)) and m.group(1) not in options:
        raise ValueError(f"{where!r} uses ${m.group(1)}, which isn't an option")


def check_show_when(rule: Any, options: dict[str, Option], where: str = "element") -> None:
    """A show_when is a mapping; every key must hold (an implicit "all"). Keys:

    - a fact name (facts.FACT_NAMES): equals a value (`resolution: 4K`), is one of a list (`resolution: [4K, 1080P]`),
      or is within a range (`imdb: {min: 7.5}`, `{max: 6}`, both)
    - `has: imdb` or `has: [imdb, rt_critic]`: the fact(s) are known (not None; for atmos and dts_x, true)
    - `added_within_days: 14` (or an $option): added to Plex that recently; 0 means never
    - `option: {ratings: imdb}`: the option equals the value, or for a multiple choice, includes it
    - `any: [rule, …]`, `all: [rule, …]`, `not: rule`
    """
    if not isinstance(rule, dict) or not rule:
        raise ValueError(f"{where!r}: show_when must be a mapping with at least one rule")
    for key, value in rule.items():
        if key == "has":
            names = value if isinstance(value, list) else [value]
            bad = [n for n in names if n not in FACT_NAMES]
            if bad or not names:
                raise ValueError(f"{where!r}: has: unknown fact(s) {bad}")
        elif key == "added_within_days":
            if isinstance(value, bool) or not (isinstance(value, int) or (isinstance(value, str) and OPTION_REF.match(value))):
                raise ValueError(f"{where!r}: added_within_days takes a whole number of days or an $option")
            _check_refs(value, options, where)
        elif key == "option":
            if not isinstance(value, dict) or not value:
                raise ValueError(f"{where!r}: option: takes a mapping of option name to value")
            for name in value:
                if name not in options:
                    raise ValueError(f"{where!r}: option: {name!r} isn't an option")
        elif key in ("any", "all"):
            if not isinstance(value, list) or not value:
                raise ValueError(f"{where!r}: {key}: takes a list of rules")
            for part in value:
                check_show_when(part, options, where)
        elif key == "not":
            check_show_when(value, options, where)
        elif key in FACT_NAMES:
            if isinstance(value, dict):
                if not value or set(value) - {"min", "max"}:
                    raise ValueError(f"{where!r}: {key}: a range takes min and/or max")
                for bound in value.values():
                    _check_number(bound)
                    _check_refs(bound, options, where)
            elif isinstance(value, list) and not value:
                raise ValueError(f"{where!r}: {key}: an empty list matches nothing")
        else:
            raise ValueError(f"{where!r}: show_when: unknown key {key!r}")


class StyleError(ValueError):
    """A style file that can't be used, with every problem in plain words."""


def load_style(text: str) -> Style:
    try:
        data = YAML(typ="safe").load(text)
    except Exception as error:  # ruamel raises several types; all mean "not YAML"
        raise StyleError(f"not valid YAML: {error}") from error
    if not isinstance(data, dict):
        raise StyleError("a style file is a mapping with studio_style, name and elements")
    try:
        return Style.model_validate(data)
    except ValidationError as error:
        raise StyleError("; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in error.errors())) from error
