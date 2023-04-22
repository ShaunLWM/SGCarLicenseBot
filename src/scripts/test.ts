import { extname } from "../lib/Helper";


console.log(extname("https://google.com/image.jpeg"))
console.log(extname("https://google.com/image.jpeg?hi=true"))
console.log(extname("https://google.com/image.jpeg?hi=true&hello=false"))
console.log(extname("https://google.com/image.jpeg?hi=hi.bye.lmao"))
console.log(extname("https://google.com/image.jpeg?hi=hi.bye.lmao#cool"))
console.log(extname("https://google.com/image.jpeg?hi=trrue&bye=false#what"))
