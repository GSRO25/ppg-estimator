from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    upload_dir: str = "/data/uploads"
    export_dir: str = "/data/exports"
    model_dir: str = "/app/models"

    class Config:
        env_file = ".env"

settings = Settings()
