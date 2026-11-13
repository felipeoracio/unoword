"""Run only the in-process workspace API suite, with outbound sockets forbidden.

The shared conftest also offers opt-in live QA fixtures. This runner never selects
those tests, disables live opt-in and makes any missed network mock fail closed.
Serial mode keeps the socket guard in this process (pytest.ini permits -n 0).
"""
if __name__ == '__main__':
    import os
    import socket
    import sys
    from pathlib import Path

    def reject_connection(*args, **kwargs):
        raise AssertionError('Outbound connections forbidden in isolated workspace tests')

    socket.socket.connect = reject_connection
    socket.socket.connect_ex = reject_connection
    os.environ['UNOWORD_RUN_LIVE_TESTS'] = '0'
    backend = Path(__file__).resolve().parents[1]
    os.chdir(backend)
    sys.path.insert(0, str(backend))
    import pytest
    raise SystemExit(pytest.main(['tests/test_workspace.py', '-q', '-n', '0']))
