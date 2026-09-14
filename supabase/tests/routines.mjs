// Isolated PostgreSQL validation; never connects to a Supabase project.
// npm install --prefix /tmp/workout-sql-test --no-audit --no-fund @electric-sql/pglite
// PGLITE_MODULE=/tmp/workout-sql-test/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/routines.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const pg = new PGlite();
const userA = randomUUID();
const userB = randomUUID();
await pg.exec(`
  create role authenticated;
  create role anon;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  insert into auth.users values ('${userA}'), ('${userB}');
`);
for (const migration of ['20260910100000_workout_sync.sql', '20260914160000_routines.sql']) {
  await pg.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
}
const asUser = async (user) => { await pg.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user}';`); };
await asUser(userA);
assert.equal((await pg.query(`select private.valid_exercise_target('{"metric":"reps","sets":3.0,"restSec":90,"repsMin":8.0,"repsMax":12.0}'::jsonb) as valid`)).rows[0].valid, true);
const reps = { metric: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 90 };
const timed = { metric: 'time', sets: 2, durationSec: 45, restSec: 60 };
const entry = (target) => ({ id: randomUUID(), exerciseId: randomUUID(), exerciseName: 'Squat', target });
const entries = [entry(reps), entry(timed)];
const routineId = randomUUID();
await pg.query('insert into routines (id, title, exercises, created_at) values ($1, $2, $3, now())', [routineId, 'Full body', JSON.stringify(entries)]);
assert.deepEqual((await pg.query('select exercises from routines')).rows[0].exercises, entries);
await pg.query('update routines set title = $1 where id = $2', ['Edited', routineId]);
assert.equal((await pg.query('select title from routines')).rows[0].title, 'Edited');

let rejected = 0;
const reject = async (query, parameters, code) => {
  await assert.rejects(pg.query(query, parameters), (error) => error.code === code);
  rejected++;
};
// Check constraints reject malformed arrays and all target branches, even for
// direct API writes that bypass the TypeScript validation layer.
for (const invalid of [null, [], {}, [null], [entry(null)], [entries[0], entries[0]],
  [entry({ ...reps, sets: 0 })], [entry({ ...reps, sets: 1.5 })],
  [entry({ ...reps, repsMin: 13 })], [entry({ ...reps, restSec: 4 })],
  [entry({ ...reps, durationSec: null })], [entry({ ...timed, repsMin: 8 })],
  [entry({ ...timed, durationSec: 0 })], [entry({ ...timed, metric: 'invalid' })],
  Array.from({ length: 41 }, () => entry(reps)),
]) {
  await reject('update routines set exercises = $1 where id = $2', [JSON.stringify(invalid), routineId], '23514');
}
await reject('update routines set title = $1 where id = $2', [' ', routineId], '23514');
await reject('update routines set user_id = $1 where id = $2', [userB, routineId], '42501');
await asUser(userB);
assert.equal((await pg.query('select * from routines')).rows.length, 0);
assert.equal((await pg.query('update routines set title = $1 where id = $2 returning id', ['Stolen', routineId])).rows.length, 0);
assert.equal((await pg.query('delete from routines where id = $1 returning id', [routineId])).rows.length, 0);
await reject('insert into routines (id, user_id, title, exercises, created_at) values ($1,$2,$3,$4,now())', [randomUUID(), userA, 'Wrong owner', JSON.stringify(entries)], '42501');
await pg.exec('reset role; set role anon;');
await reject('select * from routines', [], '42501');
await asUser(userA);
// A pre-routines client can still write a block without a target.
const exerciseId = randomUUID();
const sessionId = randomUUID();
const blockId = randomUUID();
await pg.query("insert into exercises (id,name,name_key,load_type,metric,is_custom) values ($1,'Squat','squat','external','reps',false)", [exerciseId]);
await pg.query('insert into sessions (id,started_at,date) values ($1,now(),current_date)', [sessionId]);
await pg.query('insert into session_exercises (id,session_id,exercise_id,position) values ($1,$2,$3,0)', [blockId, sessionId, exerciseId]);
await pg.query('update session_exercises set target = $1 where id = $2', [JSON.stringify(reps), blockId]);
await reject('update session_exercises set target = $1 where id = $2', [JSON.stringify({ ...reps, sets: 0 }), blockId], '23514');
await pg.query('delete from routines where id = $1', [routineId]);
assert.deepEqual((await pg.query('select target from session_exercises where id = $1', [blockId])).rows[0].target, reps);
await pg.close();
console.log(`Routines migration passed: valid writes, ${rejected} rejected writes, account isolation, legacy blocks and retained session targets.`);
