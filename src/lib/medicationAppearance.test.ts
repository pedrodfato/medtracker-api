process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryForForm, parseMedicationColor, parseMedicationForm } from './medicationAppearance.js';

test('parseMedicationForm: aceita só as formas conhecidas', () => {
  assert.equal(parseMedicationForm('capsule'), 'capsule');
  assert.equal(parseMedicationForm('tablet_round'), 'tablet_round');
  assert.equal(parseMedicationForm('pill'), null);
  assert.equal(parseMedicationForm(''), null);
  assert.equal(parseMedicationForm(undefined), null);
  assert.equal(parseMedicationForm(3), null);
});

test('parseMedicationColor: aceita #RRGGBB e normaliza para maiúsculas', () => {
  assert.equal(parseMedicationColor('#a3d911'), '#A3D911');
  assert.equal(parseMedicationColor('#F2F2EE'), '#F2F2EE');
  assert.equal(parseMedicationColor('#fff'), null);
  assert.equal(parseMedicationColor('red'), null);
  assert.equal(parseMedicationColor('#A3D911; drop table'), null);
  assert.equal(parseMedicationColor(undefined), null);
});

test('categoryForForm: mantém o filtro antigo da lista funcionando', () => {
  assert.equal(categoryForForm('tablet_round'), 'pill');
  assert.equal(categoryForForm('tablet_oval'), 'pill');
  assert.equal(categoryForForm('capsule'), 'pill');
  assert.equal(categoryForForm('drops'), 'drop');
  assert.equal(categoryForForm('syrup'), 'drop');
  assert.equal(categoryForForm('injection'), 'vitamin');
  assert.equal(categoryForForm('ointment'), 'vitamin');
  assert.equal(categoryForForm('sachet'), 'vitamin');
});
