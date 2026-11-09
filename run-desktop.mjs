// Simple runner for Act Dock desktop functionality
import { discoverAllWorkflows, detectCiCdPlatform } from './apps/desktop/scripts/discover-workflows.ts';

async function main() {
  const args = process.argv.slice(2);
  const projectPath = args[0] || process.cwd();
  
  console.log('Act Dock - CI/CD Workflow Discovery');
  console.log('===================================');
  console.log('Project path:', projectPath);
  console.log();
  
  const platform = await detectCiCdPlatform(projectPath);
  console.log('Platform:', platform);
  console.log();
  
  const workflows = await discoverAllWorkflows(projectPath);
  console.log('Workflows found:', workflows.length);
  console.log();
  
  if (workflows.length === 0) {
    console.log('No workflows found. Make sure the project has:');
    console.log('  - .github/workflows/ directory (GitHub Actions), or');
    console.log('  - .gitlab-ci.yml file (GitLab CI)');
  } else {
    workflows.forEach((w, i) => {
      console.log(`(${i + 1}) ${w.name} (${w.source})`);
      console.log(`    Events: ${w.events.join(', ')}`);
      if (w.diagnostic) {
        console.log(`    Diagnostic: ${w.diagnostic}`);
      }
    });
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
