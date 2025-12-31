
import { useState, useEffect, useCallback, useRef } from 'react';

interface UseSpeechRecognitionProps {
    onResult?: (transcript: string) => void;
    onEnd?: (finalTranscript: string) => void;
    silenceDuration?: number; // Auto-stop after silence (ms)
}

export const useSpeechRecognition = ({ 
    onResult, 
    onEnd, 
    silenceDuration = 1200 
}: UseSpeechRecognitionProps = {}) => {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [isSupported, setIsSupported] = useState(false);
    
    const recognitionRef = useRef<any>(null);
    const silenceTimerRef = useRef<any>(null);
    const noSpeechTimerRef = useRef<any>(null);
    const finalTranscriptRef = useRef('');

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        
        if (SpeechRecognition) {
            setIsSupported(true);
            const recognition = new SpeechRecognition();
            recognition.lang = 'zh-CN';
            recognition.interimResults = true;
            recognition.continuous = false; 
            recognition.maxAlternatives = 1;

            recognition.onstart = () => {
                setIsListening(true);
                finalTranscriptRef.current = '';
                setTranscript('');
                
                // Safety: Stop if no speech detected at all within 8 seconds
                if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
                noSpeechTimerRef.current = setTimeout(() => {
                    if (finalTranscriptRef.current === '' && !recognition.resultReceived) {
                        try { recognition.stop(); } catch(e) {}
                    }
                }, 8000);
            };

            recognition.onresult = (event: any) => {
                // Mark that we received results so noSpeechTimer doesn't kill us
                recognition.resultReceived = true;
                if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);

                let interim = '';
                let final = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                const currentText = final || interim;
                setTranscript(currentText);
                if (final) {
                     finalTranscriptRef.current += final;
                }
                
                if (onResult) onResult(currentText);

                // Reset silence timer on any result
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = setTimeout(() => {
                    if (isListening) {
                        try { recognition.stop(); } catch(e) {}
                    }
                }, silenceDuration);
            };

            recognition.onend = () => {
                setIsListening(false);
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
                
                const result = finalTranscriptRef.current || transcript; 
                if (onEnd) onEnd(result);
            };

            recognition.onerror = (event: any) => {
                console.error("Speech Recognition Error", event.error);
                setIsListening(false);
            };

            recognitionRef.current = recognition;
        } else {
            console.warn("Browser does not support Web Speech API");
            setIsSupported(false);
        }
        
        return () => {
             if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
             if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
        };
    }, [silenceDuration, onResult, onEnd, transcript]); 

    const startListening = useCallback(() => {
        if (!isSupported) {
            console.warn("Speech Recognition not supported in this browser.");
            return;
        }
        if (recognitionRef.current && !isListening) {
            try {
                finalTranscriptRef.current = '';
                setTranscript('');
                recognitionRef.current.start();
            } catch (e) {
                console.warn("Error starting recognition", e);
            }
        }
    }, [isListening, isSupported]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (e) {}
        }
    }, []);

    const abortListening = useCallback(() => {
         if (recognitionRef.current) {
            try {
                recognitionRef.current.abort();
                setIsListening(false);
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
            } catch (e) {}
        }
    }, []);

    return { 
        isListening, 
        isSupported,
        transcript, 
        startListening, 
        stopListening, 
        abortListening,
        resetTranscript: () => setTranscript('') 
    };
};
