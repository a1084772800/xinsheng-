import { useState, useEffect, useRef, useCallback } from 'react';

interface AudioRecorderState {
    isRecording: boolean;
    volume: number; // 0-100 scale representing audio energy
    hasSpeakingStarted: boolean;
}

export const useAudioRecorder = (
    onSilenceDetected: (audioBlob: Blob) => void,
    silenceDuration: number = 1000, // Reduced slightly for snappier response
    speechThreshold: number = 20, // Increased threshold slightly
    maxDuration: number = 8000 // Force stop after 8 seconds
) => {
    const [state, setState] = useState<AudioRecorderState>({
        isRecording: false,
        volume: 0,
        hasSpeakingStarted: false
    });

    const streamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    
    // Refs for logic loop to avoid dependency staleness
    const silenceStartRef = useRef<number | null>(null);
    const frameRef = useRef<number | null>(null);
    const hasSpokenRef = useRef(false);
    const startTimeRef = useRef<number>(0);
    const maxDurationTimerRef = useRef<any>(null);

    // Robust cleanup function
    const cleanupAudioResources = () => {
        // 1. Stop Recorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            try {
                mediaRecorderRef.current.stop();
            } catch (e) {
                console.warn("Error stopping recorder", e);
            }
        }
        mediaRecorderRef.current = null;

        // 2. Stop Stream Tracks
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // 3. Close AudioContext
        if (audioContextRef.current) {
            if (audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close().catch(e => console.warn("Context close error", e));
            }
            audioContextRef.current = null;
        }

        // 4. Cancel Animation Frame
        if (frameRef.current) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
        
        // 5. Clear Timers
        if (maxDurationTimerRef.current) {
            clearTimeout(maxDurationTimerRef.current);
            maxDurationTimerRef.current = null;
        }
    };

    const stopRecording = useCallback(() => {
        // Logic to finalize is handled in onstop event of mediaRecorder
        // This function just triggers the stop
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        } else {
            // Force cleanup if something is wrong
            cleanupAudioResources();
            setState(prev => ({ ...prev, isRecording: false, volume: 0 }));
        }
    }, []);

    const startRecording = useCallback(async () => {
        try {
            cleanupAudioResources(); // Ensure clean slate

            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            streamRef.current = stream;
            
            // --- Audio Analysis Setup ---
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioContext;
            
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 512; 
            analyser.smoothingTimeConstant = 0.3; // Make meter more responsive
            
            // High-pass filter to remove low freq rumble/noise
            const biquadFilter = audioContext.createBiquadFilter();
            biquadFilter.type = "highpass";
            biquadFilter.frequency.value = 150; // Ignore anything below 150Hz (hum, wind)
            
            source.connect(biquadFilter);
            biquadFilter.connect(analyser);
            
            analyserRef.current = analyser;

            // --- Media Recorder Setup ---
            let mimeType = 'audio/webm';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'audio/mp4'; 
                if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = ''; 
            }
            
            const options = mimeType ? { mimeType } : undefined;
            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = mediaRecorder;
            
            chunksRef.current = [];
            hasSpokenRef.current = false;
            silenceStartRef.current = null;
            startTimeRef.current = Date.now();

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                // Finalize
                const type = chunksRef.current[0]?.type || 'audio/webm';
                const blob = new Blob(chunksRef.current, { type });
                
                // Only trigger callback if we actually have data and it wasn't a sterile instant stop
                if (blob.size > 0) {
                    onSilenceDetected(blob);
                }
                
                cleanupAudioResources();
                setState(prev => ({ ...prev, isRecording: false, volume: 0 }));
            };

            mediaRecorder.start();
            setState({ isRecording: true, volume: 0, hasSpeakingStarted: false });

            // Safety Valve: Force stop after maxDuration
            maxDurationTimerRef.current = setTimeout(() => {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    console.log("Max duration reached, forcing stop");
                    stopRecording();
                }
            }, maxDuration);

            // --- Analysis Loop (VAD) ---
            const checkVolume = () => {
                if (!analyserRef.current || !state.isRecording && !mediaRecorderRef.current) return;
                
                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getByteFrequencyData(dataArray);
                
                // Smart VAD: Only look at human voice frequencies (approx bins 2 to 128 for 512 FFT)
                // This ignores super high hiss and super low rumble if filter leaked
                let sum = 0;
                let count = 0;
                // Optimization: Only scan relevant bins
                const startBin = 2; 
                const endBin = Math.min(100, dataArray.length); 
                
                for(let i = startBin; i < endBin; i++) {
                    sum += dataArray[i];
                    count++;
                }
                const average = count > 0 ? sum / count : 0;
                
                // Visual volume (boosted slightly for UI)
                const visualVolume = Math.min(100, Math.max(0, (average - 10) * 2));

                setState(prev => ({ 
                    ...prev, 
                    volume: visualVolume,
                    hasSpeakingStarted: hasSpokenRef.current 
                }));

                // VAD Logic
                if (average > speechThreshold) {
                    silenceStartRef.current = null; // Reset silence timer
                    hasSpokenRef.current = true;
                } else if (hasSpokenRef.current) {
                    // We are in silence after speech
                    if (silenceStartRef.current === null) {
                        silenceStartRef.current = Date.now();
                    } else if (Date.now() - silenceStartRef.current > silenceDuration) {
                        // Silence detected for long enough -> STOP
                        stopRecording();
                        return;
                    }
                }

                frameRef.current = requestAnimationFrame(checkVolume);
            };

            checkVolume();

        } catch (err) {
            console.error("Error accessing microphone:", err);
            setState(prev => ({ ...prev, isRecording: false }));
        }
    }, [onSilenceDetected, silenceDuration, speechThreshold, stopRecording, maxDuration]);

    // Global cleanup on unmount
    useEffect(() => {
        return () => {
            cleanupAudioResources();
        };
    }, []);

    return {
        isRecording: state.isRecording,
        volume: state.volume,
        hasSpeakingStarted: state.hasSpeakingStarted,
        startRecording,
        stopRecording
    };
};
