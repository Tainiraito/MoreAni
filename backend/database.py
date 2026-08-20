import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./moreani.db')

engine = create_engine(
    DATABASE_URL,
    connect_args={
        'check_same_thread': False,
        # 生产使用两个 uvicorn worker。给 SQLite 写锁留出等待时间，避免短暂并发直接报 locked。
        'timeout': 10,
    },
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
