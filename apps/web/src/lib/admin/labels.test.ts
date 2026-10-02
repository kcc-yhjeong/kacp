import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABEL, AUDIT_TARGET_LABEL, auditActionLabel, userStatusOf } from './labels';

// Copied from 03-data-model.md `audit_events.action` / `target_type`. Keep in sync.
const DOC_ACTIONS =
  'user.create user.disable user.reset_password team.create team.delete membership.add membership.remove department.create department.update department.move department.archive user.department_change import.apply agent.assign agent.unassign template.update container.start container.stop container.restart resources.update deploy.approve deploy.reject app.force_stop app.force_resume team.update membership.role_change user.enable mcp.resume mcp.set_default mcp.approve mcp.reject mcp.suspend mcp.install mcp.remove mcp.manual_add settings.update'.split(
    ' ',
  );
const DOC_TARGETS = 'user department team app mcp_package mcp_version template settings import'.split(' ');

describe('audit labels', () => {
  it('cover every documented action in Korean', () => {
    for (const a of DOC_ACTIONS) {
      expect(AUDIT_ACTION_LABEL[a], a).toBeTruthy();
      expect(AUDIT_ACTION_LABEL[a]).toMatch(/[가-힣]/);
    }
  });
  it('cover every documented target type', () => {
    for (const t of DOC_TARGETS) expect(AUDIT_TARGET_LABEL[t], t).toBeTruthy();
  });
  it('fall back to the raw action', () => {
    expect(auditActionLabel('future.thing')).toBe('future.thing');
  });
});

describe('userStatusOf', () => {
  it('derives the password-change state', () => {
    expect(userStatusOf({ status: 'active', mustChangePassword: true })).toBe('must_change_password');
    expect(userStatusOf({ status: 'active', mustChangePassword: false })).toBe('active');
    expect(userStatusOf({ status: 'disabled', mustChangePassword: true })).toBe('disabled');
  });
});
