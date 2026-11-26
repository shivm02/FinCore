module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert', 'security']
    ],
    'scope-enum': [
      1,
      'always',
      ['web', 'api', 'ledger', 'transfers', 'auth', 'payments', 'analytics', 'calc', 'db', 'docker', 'ci', 'deploy', 'docs', 'tests', 'incident']
    ]
  }
};
