const test = require('node:test');
const assert = require('node:assert/strict');
const {
    cleanUsername, toEmail, assertUsername, assertPassword, assertRole, assertUuid, cleanLocation,
} = require('../netlify/lib/validate');

test('usernames are lowercased, trimmed and pattern-checked', () => {
    assert.equal(assertUsername('  JSmith  '), 'jsmith');
    assert.equal(assertUsername('a.b_c-9'), 'a.b_c-9');
    for (const bad of ['ab', 'has space', 'x'.repeat(33), 'bad@name', '']) {
        assert.throws(() => assertUsername(bad), (e) => e.status === 400 && e.code === 'bad_username');
    }
});

test('cleanUsername and toEmail', () => {
    assert.equal(cleanUsername('  Bob '), 'bob');
    assert.equal(cleanUsername(undefined), '');
    assert.equal(toEmail('bob'), 'bob@pcg-map.local');
});

test('passwords must be 8-72 characters', () => {
    assert.equal(assertPassword('12345678'), '12345678');
    for (const bad of ['1234567', 'x'.repeat(73), undefined, 12345678]) {
        assert.throws(() => assertPassword(bad), (e) => e.status === 400 && e.code === 'bad_password');
    }
});

test('role and uuid checks', () => {
    assert.equal(assertRole('admin'), 'admin');
    assert.throws(() => assertRole('owner'), (e) => e.code === 'bad_role');
    assert.equal(assertUuid('11111111-1111-1111-1111-111111111111'), '11111111-1111-1111-1111-111111111111');
    assert.throws(() => assertUuid('nope'), (e) => e.code === 'bad_id');
});

test('cleanLocation builds only the columns for the type', () => {
    const mp = cleanLocation('mp', { external_id: 'MP 1', lat: '40.1', lng: '-75.2', radius_miles: '1.5', name: 'ignored' });
    assert.deepEqual(mp, { external_id: 'MP 1', lat: 40.1, lng: -75.2, radius_miles: 1.5 });

    const dunkin = cleanLocation('dunkin', {
        external_id: '9', address: '1 Main St', region: 'Bucks', lat: 40, lng: -75, combo: 'true', property_name: 'Main',
    });
    assert.deepEqual(dunkin, { external_id: '9', address: '1 Main St', region: 'Bucks', lat: 40, lng: -75, property_name: 'Main', combo: true });
});

test('cleanLocation rejects missing or invalid fields on create', () => {
    assert.throws(() => cleanLocation('mp', { lat: 1, lng: 1, radius_miles: 1 }), (e) => e.code === 'bad_field');
    assert.throws(() => cleanLocation('bww_pa', { name: 'n', address: 'a', lat: 95, lng: 0 }), (e) => e.code === 'bad_field');
    assert.throws(() => cleanLocation('nope', {}), (e) => e.code === 'bad_type');
});

test('cleanLocation partial only validates provided fields', () => {
    assert.deepEqual(cleanLocation('mp', { radius_miles: 2 }, { partial: true }), { radius_miles: 2 });
    assert.deepEqual(cleanLocation('dunkin', { property_name: '' }, { partial: true }), { property_name: null });
    assert.deepEqual(cleanLocation('mp', { active: false }, { partial: true }), { active: false });
});
