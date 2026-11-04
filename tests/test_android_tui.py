"""Exercise the Android adapter with real prompt-toolkit layout objects."""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from prompt_toolkit import PromptSession
from prompt_toolkit.input import DummyInput
from prompt_toolkit.output import DummyOutput
from prompt_toolkit.layout import FloatContainer, HSplit, Window
from prompt_toolkit.layout.dimension import Dimension

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("android_tui", ROOT / "app/src/main/assets/runtime/android_tui.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AndroidLayoutTest(unittest.TestCase):
    def test_compact_prompt_keeps_completions_input_and_toolbar(self):
        class Terminal:
            def __init__(self, session):
                self.session = session

        tui = SimpleNamespace(Terminal=Terminal)
        kaipi = ModuleType("kaipi")
        kaipi.tui = tui
        with patch.dict(sys.modules, {"kaipi": kaipi}):
            adapter.install()
            adapted = tui.Terminal
            adapter.install()
            self.assertIs(tui.Terminal, adapted)
            session = PromptSession(input=DummyInput(), output=DummyOutput(), bottom_toolbar="status")
            original = session.layout.container
            spacer = Window()
            session.layout.container = FloatContainer(HSplit([spacer, original]), [])
            terminal = tui.Terminal(session)
            self.assertIs(terminal.session, session)
            self.assertIs(session.layout.container.content.children[1], original)
            self.assertEqual((spacer.height.min, spacer.height.max), (0, 0))
            # Both keyboard sizes retain the same compact spacer.
            for rows in [40, 15, 40, 12, 40]:
                self.assertEqual(spacer.preferred_height(40, rows).preferred, 0)

    def test_unknown_upstream_layout_is_preserved(self):
        class Terminal:
            def __init__(self, session):
                self.session = session

        tui = SimpleNamespace(Terminal=Terminal)
        kaipi = ModuleType("kaipi")
        kaipi.tui = tui
        with patch.dict(sys.modules, {"kaipi": kaipi}):
            adapter.install()
            prompt = Window(height=Dimension.exact(3))
            session = SimpleNamespace(layout=SimpleNamespace(container=prompt))
            tui.Terminal(session)
            self.assertIs(session.layout.container, prompt)
            self.assertEqual(prompt.height.preferred, 3)
            session.layout.container = FloatContainer(HSplit([]), [])
            tui.Terminal(session)


if __name__ == "__main__":
    unittest.main()
