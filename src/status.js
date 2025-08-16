console.log("Inky's status page script loaded!");

const animationContainer = document.getElementById('inky-animation');

// Create Inky's body
const body = document.createElement('div');
body.className = 'octopus-body';
animationContainer.appendChild(body);

// Create Inky's eyes
const eye1 = document.createElement('div');
eye1.className = 'octopus-eye';
eye1.style.left = '25%'; // Position the first eye
body.appendChild(eye1);

const eye2 = document.createElement('div');
eye2.className = 'octopus-eye';
eye2.style.right = '25%'; // Position the second eye
body.appendChild(eye2);

// Create Inky's tentacles
const numTentacles = 8;
for (let i = 0; i < numTentacles; i++) {
    const tentacle = document.createElement('div');
    const initialRotation = (i / numTentacles) * 360;
    tentacle.style.setProperty('--initial-rotation', `${initialRotation}deg`);

    // Assign specific classes for animation
    if (i === 3) {
        tentacle.className = 'octopus-tentacle paper-grabber';
    } else if (i === 7) {
        tentacle.className = 'octopus-tentacle printer-operator';
    } else {
        tentacle.className = 'octopus-tentacle wiggler';
    }
    
    animationContainer.appendChild(tentacle);
}

// Create printing equipment
const printer = document.createElement('div');
printer.id = 'printer';
animationContainer.appendChild(printer);

const paperStack = document.createElement('div');
paperStack.id = 'paper-stack';
animationContainer.appendChild(paperStack);
