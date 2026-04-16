from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_extract_dxf_returns_fixtures(simple_dxf_path):
    with open(simple_dxf_path, "rb") as f:
        response = client.post(
            "/extract/dwg",
            files={"file": ("test.dxf", f, "application/octet-stream")},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["format"] == "dxf"
    assert data["units"] == "metres"
    fixture_names = [fix["block_name"] for fix in data["fixtures"]]
    assert "WC" in fixture_names
    assert "BASIN" in fixture_names
    # Check pipes
    pipe_layers = [p["layer"] for p in data["pipes"]]
    assert "P-SANITARY" in pipe_layers


def test_extract_complex_dxf(complex_dxf_path):
    with open(complex_dxf_path, "rb") as f:
        response = client.post(
            "/extract/dwg",
            files={"file": ("complex.dxf", f, "application/octet-stream")},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["units"] == "mm"
    counts = {fix["block_name"]: fix["count"] for fix in data["fixtures"]}
    assert counts["WC"] == 5
    assert counts["SHOWER"] == 3


def test_extract_rejects_invalid_format():
    response = client.post(
        "/extract/dwg",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
