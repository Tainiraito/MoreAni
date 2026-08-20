from concurrent.futures import ThreadPoolExecutor

from models import InviteCode, User


def registration_body(code: str, suffix: str) -> dict[str, str]:
    return {
        'invite_code': code,
        'username': f'user-{suffix}',
        'nickname': f'nick-{suffix}',
        'password': 'password123',
    }


def test_single_use_invite_and_failed_registration_rolls_back(client, db):
    invite = InviteCode(code='ONCE', max_uses=1, use_count=0)
    rollback_invite = InviteCode(code='ROLLBACK', max_uses=1, use_count=0)
    existing = User(
        username='existing',
        nickname='existing-nick',
        password_hash='not-used',
        role='user',
    )
    db.add_all([invite, rollback_invite, existing])
    db.commit()

    first = client.post('/api/v1/auth/register', json=registration_body('ONCE', 'one'))
    second = client.post('/api/v1/auth/register', json=registration_body('ONCE', 'two'))
    assert first.status_code == 201
    assert second.status_code == 409

    conflict = registration_body('ROLLBACK', 'conflict')
    conflict['username'] = existing.nickname
    assert client.post('/api/v1/auth/register', json=conflict).status_code == 409
    db.expire_all()
    assert db.query(InviteCode).filter_by(code='ROLLBACK').one().use_count == 0


def test_two_concurrent_registrations_only_one_consumes_invite(client, db):
    db.add(InviteCode(code='RACE', max_uses=1, use_count=0))
    db.commit()

    def register(suffix: str) -> int:
        return client.post('/api/v1/auth/register', json=registration_body('RACE', suffix)).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(register, ('a', 'b')))

    assert sorted(statuses) == [201, 409]
    db.expire_all()
    assert db.query(InviteCode).filter_by(code='RACE').one().use_count == 1
    assert db.query(User).filter(User.username.in_(['user-a', 'user-b'])).count() == 1
