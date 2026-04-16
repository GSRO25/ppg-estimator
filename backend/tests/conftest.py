import pytest
import os
from tests.fixtures.create_test_dxf import create_simple_dxf, create_complex_dxf


@pytest.fixture(scope="session", autouse=True)
def generate_fixtures():
    create_simple_dxf()
    create_complex_dxf()


@pytest.fixture
def simple_dxf_path():
    return os.path.join(os.path.dirname(__file__), "fixtures", "sample_simple.dxf")


@pytest.fixture
def complex_dxf_path():
    return os.path.join(os.path.dirname(__file__), "fixtures", "sample_complex.dxf")
