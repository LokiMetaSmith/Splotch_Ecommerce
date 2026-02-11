import { Jimp } from 'jimp';

async function test() {
    const image = await Jimp.create(100, 100, 0xFF0000FF);
    console.log('Original:', image.width, image.height);
    image.scaleToFit({ w: 50, h: 50 }); // Try object syntax
    console.log('Scaled (obj):', image.width, image.height);
}

test().catch(console.error);
