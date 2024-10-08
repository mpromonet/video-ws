/* ---------------------------------------------------------------------------
** This software is in the public domain, furnished "as is", without technical
** support, and with no warranty, express or implied, as to its usefulness for
** any purpose.
**
** -------------------------------------------------------------------------*/

import { MediaStream } from './mediastream.js';

const scriptPath = new URL(import.meta.url).pathname;

class VideoWsElement extends HTMLElement {
    static observedAttributes = ["url"];
  
    constructor() {
      super();
      this.shadowDOM = this.attachShadow({mode: 'open'});
      this.shadowDOM.innerHTML = `
                  <link rel="stylesheet" href="${scriptPath.substring(0, scriptPath.lastIndexOf('/'))}/video-ws.css">
                  <div class="videoContent">
                    <video id="video" muted playsinline controls preload="none"></video>
                    <div id="spinner" class="loading"></div>
                  </div>`;      
                  

        this.audioContext = new AudioContext();
        const canvas = document.createElement("canvas");
        this.stream = canvas.captureStream();
        const audioTrack = this.audioContext.createMediaStreamDestination().stream.getAudioTracks()[0];
        this.mediaStream = new MediaStream(canvas, this.audioContext, (loaded) => {
                if (loaded) {
                    this.shadowDOM.getElementById("spinner").classList.remove("loading");
                } else {
                    this.shadowDOM.getElementById("spinner").classList.add("loading");
                }            
            }, (loaded) => {
                if (loaded) {                    
                    this.stream.addTrack(audioTrack);          
                    this.audioContext.resume();
                } else {                    
                    this.stream.removeTrack(audioTrack);
                    this.audioContext.suspend();
                }            
            }
        );
    }
  
    connectedCallback() {
        console.log("connectedCallback");

        const video = this.shadowDOM.getElementById("video");
        video.srcObject = this.stream;
        video.addEventListener('play', () => this.audioContext.resume());
        video.addEventListener('pause', () => this.audioContext.suspend());
        video.addEventListener('volumechange', () => this.mediaStream.setVolume(video.muted ? 0 : video.volume));
        this.audioContext.onstatechange = () => {
            switch(this.audioContext.state) {
                case 'suspended':
                    video.muted = true;
                    break;
                case 'running':
                    video.muted = false;
                    break;
            }
        };
        video.play();
    }
  
    disconnectedCallback() {
        console.log("disconnectedCallback");
        this.mediaStream.close();
    }
    
    attributeChangedCallback(name, oldValue, newValue) {
        console.log(`Attribute ${name} has changed.`);
        if (name === "url" && oldValue !== newValue) {
            this.shadowDOM.getElementById("spinner").classList.add("loading");
            this.mediaStream.connect(newValue);
        }
    }
  }
  
  customElements.define("video-ws", VideoWsElement);