"""Opt-in live suites wait for the asynchronous source contract without resetting usage."""
import time


def wait_for_source(client, source, timeout=120):
    deadline=time.monotonic()+timeout
    next_kick=0
    while source['processing_status'] in {'pending','processing'}:
        if time.monotonic()>deadline:
            raise AssertionError('Source processing did not finish within the live-test deadline')
        if time.monotonic()>=next_kick:
            response=client.post('/processing/run',json={})
            assert response.status_code in {202,429},response.text
            next_kick=time.monotonic()+8
        time.sleep(1)
        response=client.get(f"/documents/status/{source['id']}")
        assert response.status_code==200,response.text
        source=response.json()
    return source
