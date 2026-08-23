import json

from conftest import auth_cookie

from models import User

# 1x1 GIF89a with a valid logical screen.
GIF_BYTES = (
    b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;'
)
NETSCAPE_EXTENSION = b'\x21\xff\x0bNETSCAPE2.0\x03\x01'
JPEG_BYTES = b'\xff\xd8\xff\xd9'


def _gif_with_loop_count(count: int) -> bytes:
    extension = NETSCAPE_EXTENSION + count.to_bytes(2, 'little') + b'\x00'
    return GIF_BYTES[:19] + extension + GIF_BYTES[19:]


def _gif_loop_count(data: bytes) -> int:
    index = data.index(NETSCAPE_EXTENSION) + len(NETSCAPE_EXTENSION)
    return int.from_bytes(data[index : index + 2], 'little')


def test_avatar_crop_migration_is_idempotent(monkeypatch):
    from sqlalchemy import create_engine, text

    import main

    engine = create_engine('sqlite:///:memory:')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE users (id INTEGER PRIMARY KEY)'))
    monkeypatch.setattr(main, 'engine', engine)

    main._migrate_users_avatar_crop()
    main._migrate_users_avatar_crop()

    with engine.connect() as connection:
        columns = [row[1] for row in connection.execute(text('PRAGMA table_info(users)'))]
    assert columns.count('avatar_crop') == 1


def _upload(client, user, filename, data, content_type='image/gif', crop=None):
    form = {}
    if crop is not None:
        form['crop'] = json.dumps(crop)
    return client.post(
        '/api/v1/user/avatar',
        files={'file': (filename, data, content_type)},
        data=form,
        cookies=auth_cookie(user),
    )


def test_gif_upload_preserves_file_and_crop(client, db, make_user, monkeypatch, tmp_path):
    import routers.v1.user as user_router

    avatars_dir = tmp_path / 'avatars'
    monkeypatch.setattr(user_router, 'AVATARS_DIR', str(avatars_dir))
    user = make_user('gif-user')
    crop = {'version': 1, 'x': 0, 'y': 0, 'size': 1}

    response = _upload(client, user, 'animated.gif', GIF_BYTES, crop=crop)

    assert response.status_code == 200
    payload = response.json()
    assert payload['avatar_url'].split('?', 1)[0].endswith('.gif')
    assert payload['avatar_crop'] == crop
    filename = payload['avatar_url'].split('/api/avatars/', 1)[1].split('?', 1)[0]
    saved_bytes = (avatars_dir / filename).read_bytes()
    assert _gif_loop_count(saved_bytes) == 0
    assert saved_bytes[:19] == GIF_BYTES[:19]
    assert GIF_BYTES[19:] in saved_bytes
    db.expire_all()
    assert json.loads(db.query(User).filter_by(id=user.id).one().avatar_crop) == crop


def test_gif_loop_normalization_adds_or_replaces_loop_count():
    from services.avatar import normalize_gif_loop

    normalized_without_extension = normalize_gif_loop(GIF_BYTES)
    assert _gif_loop_count(normalized_without_extension) == 0
    assert normalized_without_extension[:19] == GIF_BYTES[:19]
    assert GIF_BYTES[19:] in normalized_without_extension

    normalized_finite = normalize_gif_loop(_gif_with_loop_count(1))
    assert _gif_loop_count(normalized_finite) == 0
    assert normalized_finite.count(NETSCAPE_EXTENSION) == 1
    assert normalized_finite[:19] == GIF_BYTES[:19]
    assert GIF_BYTES[19:] in normalized_finite


def test_gif_crop_is_validated_and_can_default_to_center(client, make_user, monkeypatch, tmp_path):
    import routers.v1.user as user_router

    monkeypatch.setattr(user_router, 'AVATARS_DIR', str(tmp_path / 'avatars'))
    user = make_user('gif-validation-user')

    invalid = _upload(client, user, 'bad.gif', GIF_BYTES, crop={'version': 1, 'x': 1, 'y': 0, 'size': 1})
    assert invalid.status_code == 400

    default_crop = _upload(client, user, 'default.gif', GIF_BYTES)
    assert default_crop.status_code == 200
    assert default_crop.json()['avatar_crop'] is None


def test_replacing_and_deleting_avatar_cleans_crop_and_old_file(client, db, make_user, monkeypatch, tmp_path):
    import routers.v1.user as user_router

    avatars_dir = tmp_path / 'avatars'
    monkeypatch.setattr(user_router, 'AVATARS_DIR', str(avatars_dir))
    user = make_user('avatar-replace-user')
    crop = {'version': 1, 'x': 0, 'y': 0, 'size': 1}

    gif_response = _upload(client, user, 'first.gif', GIF_BYTES, crop=crop)
    gif_name = gif_response.json()['avatar_url'].split('/api/avatars/', 1)[1].split('?', 1)[0]
    assert (avatars_dir / gif_name).exists()

    jpg_response = _upload(client, user, 'second.jpg', JPEG_BYTES, 'image/jpeg')
    assert jpg_response.status_code == 200
    jpg_name = jpg_response.json()['avatar_url'].split('/api/avatars/', 1)[1].split('?', 1)[0]
    assert jpg_name.endswith('.jpg')
    assert not (avatars_dir / gif_name).exists()
    db.expire_all()
    saved = db.query(User).filter_by(id=user.id).one()
    assert saved.avatar_crop is None

    delete_response = client.delete('/api/v1/user/avatar', cookies=auth_cookie(user))
    assert delete_response.status_code == 200
    assert delete_response.json() == {'avatar_url': None, 'avatar_crop': None}
    assert not (avatars_dir / jpg_name).exists()
