import {defineConfig} from 'vite';
export default defineConfig({
 // Prepare lazy preview dependencies before first use, avoiding a dev reload
 // while a material preview or GIF export is in progress.
 optimizeDeps:{include:['gifenc','three/addons/environments/RoomEnvironment.js']},
});
