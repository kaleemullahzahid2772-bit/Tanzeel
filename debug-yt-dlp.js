const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ytDlpPath = path.join(__dirname, 'yt-dlp');

console.log('=== YT-DLP DEBUG ===');
console.log('ytDlpPath:', ytDlpPath);
console.log('EXISTS:', fs.existsSync(ytDlpPath));

if (fs.existsSync(ytDlpPath)) {
    const stats = fs.statSync(ytDlpPath);
    console.log('Size:', stats.size);
    console.log('Is directory:', stats.isDirectory());
    console.log('Permissions (octal):', stats.mode.toString(8));
    console.log('Creation time:', stats.birthtime);
    console.log('File type:');
    
    const fileHeader = fs.readFileSync(ytDlpPath, { encoding: 'binary' }).slice(0, 4);
    const magicHex = Array.from(fileHeader, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    console.log('  Magic bytes:', magicHex);
    
    const fileType = require('child_process').spawnSync('file', [ytDlpPath], { encoding: 'utf8' });
    console.log('  File command:', fileType.stdout ? fileType.stdout.trim() : fileType.stderr);
    
    const executable = () => {
        try {
            fs.accessSync(ytDlpPath, fs.constants.X_OK);
            console.log('  ✓ X_OK permission: true');
        } catch (e) {
            console.log('  ✗ X_OK permission: false', e.message);
        }
        
        try {
            fs.accessSync(ytDlpPath, fs.constants.R_OK);
            console.log('  ✓ R_OK permission: true');
        } catch (e) {
            console.log('  ✗ R_OK permission: false', e.message);
        }
    };
    executable();
}

console.log('\nTrying spawn instead of execFile:');
const spawnOptions = {
    cwd: path.dirname(ytDlpPath),
    windowsHide: false,
    shell: false
};

console.log('Spawn options:', spawnOptions);

const child = spawn(ytDlpPath, ['--version'], spawnOptions);

let stdoutData = '';
let stderrData = '';

child.stdout.on('data', (data) => {
    stdoutData += data.toString();
});

child.stderr.on('data', (data) => {
    stderrData += data.toString();
});

child.on('error', (error) => {
    console.log('Spawn error:', error);
    console.log('Error code:', error.code);
    console.log('Error syscall:', error.syscall);
    console.log('Error errno:', error.errno);
});

child.on('close', (code, signal) => {
    console.log('\n=== SPAWN RESULT ===');
    console.log('Exit code:', code);
    console.log('Signal:', signal);
    console.log('stdout:', stdoutData);
    console.log('stderr:', stderrData);
});

console.log('Spawn initiated (check output above).');

if (fs.existsSync(ytDlpPath)) {
    console.log('\nTrying different execution methods:');
    
    const testMethods = [
        () => spawn('.\yt-dlp', ['--version'], { ...spawnOptions, cwd: path.dirname(ytDlpPath) }),
        () => spawn('cmd', ['/c', 'yt-dlp', '--version'], { ...spawnOptions, cwd: path.dirname(ytDlpPath) }),
    ];
    
    testMethods.forEach((testFn, index) => {
        console.log(`\nTest method ${index + 1}:`);
        try {
            const testChild = testFn();
            testChild.stdout?.on('data', d => console.log('stdout:', d.toString().trim()));
            testChild.stderr?.on('data', d => console.log('stderr:', d.toString().trim()));
            testChild.on('close', (code, sig) => console.log('Method', index + 1, 'exit code:', code));
        } catch(e) {
            console.log('Error:', e.message);
        }
    });
}
