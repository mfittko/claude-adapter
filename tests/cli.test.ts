import { Command } from 'commander';

describe('CLI Options', () => {
    let program: Command;

    beforeEach(() => {
        program = new Command();
        program
            .option('-p, --port <port>', 'Port', '3080')
            .option('-r, --reconfigure', 'Force reconfiguration')
            .option('--no-claude-settings', 'Skip updating Claude Code settings')
            .option('--claude-command <path>', 'Claude Code executable');
    });

    describe('--claude-command option', () => {
        it('leaves the command undefined so the environment fallback can be used', () => {
            program.parse(['node', 'test']);
            expect(program.opts().claudeCommand).toBeUndefined();
        });

        it('uses an explicit command when provided', () => {
            program.parse(['node', 'test', '--claude-command', '/usr/local/bin/claude']);
            expect(program.opts().claudeCommand).toBe('/usr/local/bin/claude');
        });
    });

    describe('--no-claude-settings flag', () => {
        it('should default claudeSettings to true', () => {
            program.parse(['node', 'test']);
            expect(program.opts().claudeSettings).toBe(true);
        });

        it('should set claudeSettings to false when --no-claude-settings is passed', () => {
            program.parse(['node', 'test', '--no-claude-settings']);
            expect(program.opts().claudeSettings).toBe(false);
        });

        it('should work independently of --reconfigure', () => {
            program.parse(['node', 'test', '--reconfigure', '--no-claude-settings']);
            const opts = program.opts();
            expect(opts.reconfigure).toBe(true);
            expect(opts.claudeSettings).toBe(false);
        });

        it('should work with --port option', () => {
            program.parse(['node', 'test', '--port', '4000', '--no-claude-settings']);
            const opts = program.opts();
            expect(opts.port).toBe('4000');
            expect(opts.claudeSettings).toBe(false);
        });
    });
});
