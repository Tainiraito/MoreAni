from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from routers import animes, auth, bangumi, ratings

Base.metadata.create_all(bind=engine)

app = FastAPI(title='MoreAni API', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth.router, prefix='/api')
app.include_router(animes.router, prefix='/api')
app.include_router(ratings.router, prefix='/api')
app.include_router(bangumi.router, prefix='/api')


@app.get('/api/health')
def health():
    return {'status': 'ok'}
