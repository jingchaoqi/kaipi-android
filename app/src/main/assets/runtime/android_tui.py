"""Android layout policy, kept outside the vendored kaipi core."""


def install():
    from kaipi import tui
    from prompt_toolkit.layout import FloatContainer, HSplit, Window
    from prompt_toolkit.layout.controls import DummyControl
    from prompt_toolkit.layout.dimension import Dimension

    if getattr(tui.Terminal, "_android_compact", False):
        return

    class AndroidTerminal(tui.Terminal):
        _android_compact = True

        def __init__(self, session):
            super().__init__(session)
            layout = self.session.layout.container
            # Upstream uses an empty expanding window to pin the prompt to the
            # bottom. On a phone it becomes a keyboard-sized gap after a resize.
            if (isinstance(layout, FloatContainer) and isinstance(layout.content, HSplit)
                    and layout.content.children):
                spacer = layout.content.children[0]
                if isinstance(spacer, Window) and isinstance(spacer.content, DummyControl):
                    spacer.height = Dimension.exact(0)

    tui.Terminal = AndroidTerminal
