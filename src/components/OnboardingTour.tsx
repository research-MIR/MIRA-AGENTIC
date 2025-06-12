import { useEffect, useRef, useState } from 'react';
import { driver, Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useSession } from './Auth/SessionContextProvider';
import { useOnboardingTour } from '@/context/OnboardingTourContext';
import { useNavigate, useLocation } from 'react-router-dom';

export const OnboardingTour = () => {
  const { supabase, session } = useSession();
  const { tourRequestCount } = useOnboardingTour();
  const navigate = useNavigate();
  const location = useLocation();
  
  const driverRef = useRef<Driver | null>(null);
  const isTourActive = useRef(false);
  const [hasCompletedTour, setHasCompletedTour] = useState<boolean | null>(null);
  const lastRunCount = useRef(0);

  useEffect(() => {
    const checkTourStatus = async () => {
      if (!session?.user) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('has_completed_onboarding_tour')
        .eq('id', session.user.id)
        .single();
      
      if (error) {
        console.error("Error fetching tour status:", error);
        setHasCompletedTour(true); // Default to not showing tour on error
        return;
      }
      setHasCompletedTour(data?.has_completed_onboarding_tour ?? false);
    };
    checkTourStatus();
  }, [session, supabase]);

  useEffect(() => {
    const shouldStartManually = tourRequestCount > lastRunCount.current;
    const shouldStartAutomatically = hasCompletedTour === false && tourRequestCount === 0;

    if (!shouldStartManually && !shouldStartAutomatically) return;
    if (isTourActive.current) return;

    console.log(`[Tour] Starting tour. Manual: ${shouldStartManually}, Auto: ${shouldStartAutomatically}`);
    isTourActive.current = true;
    lastRunCount.current = tourRequestCount;

    const driverObj = driver({
      showProgress: true,
      onDestroyed: () => {
        console.log('[Tour] Tour destroyed.');
        isTourActive.current = false;
        driverRef.current = null;
        
        (async () => {
          const { error } = await supabase.rpc('set_onboarding_tour_complete');
          if (error) {
            console.error("[Tour] Error saving tour state:", error);
          } else {
            console.log("[Tour] Successfully saved tour completion state.");
            setHasCompletedTour(true);
          }
        })();
      },
      steps: [
        {
          element: '#model-selector',
          popover: {
            title: '1. Choose Your AI Model',
            description: "Each model has a unique style. Pick the one that best fits your vision. <b>Note:</b> The model can only be chosen at the start of a new chat and is locked once the conversation begins.",
            side: "bottom"
          }
        },
        {
          element: '#designer-mode-switch',
          popover: {
            title: '2. Enable "Designer Mode"',
            description: "When enabled, the agent acts like a demanding Art Director. It will generate an image, critique its own work, and then try again to improve it. This process is slower but often leads to more refined and higher-quality results. Leave it off for faster, single-shot generations.",
            side: "bottom"
          }
        },
        {
          element: '#pipeline-mode-radiogroup',
          popover: {
            title: '3. Two-Stage Pipeline Mode',
            description: `This controls a special two-stage image generation process. The first stage creates a base image, and the second stage refines it for extra detail and realism.
                        <ul>
                            <li><b>On:</b> <i>Maximum Quality.</i> Always uses the two-stage process. Best for final images.</li>
                            <li><b>Off:</b> <i>Maximum Speed.</i> Never uses the refinement stage. Good for quick drafts.</li>
                            <li><b>Auto:</b> <i>Balanced.</i> The agent decides. It will use the pipeline for high-detail models and skip it for others to balance speed and quality.</li>
                        </ul>`,
            side: "bottom"
          }
        },
        {
          element: '#prompt-input-area',
          popover: {
            title: "4. Talk to the Agent",
            description: `This is where you give instructions. Be descriptive! You can ask to:
                        <ul>
                            <li><b>Create images:</b> "A photorealistic portrait of an ancient king."</li>
                            <li><b>Analyze a style:</b> "Analyze the brand style of the website: apple.com"</li>
                            <li><b>Use a reference:</b> Upload an image and write: "Use this image as a style reference."</li>
                            <li><b>Start a creative process:</b> "Help me design a logo for a coffee shop."</li>
                        </ul>`,
            side: "top"
          }
        },
        {
          element: '#file-upload-button',
          popover: {
            title: '5. Upload a Reference',
            description: "Click here to upload an image. You can use it as a reference for style, composition, or subject. It works best with models that support image-to-image editing.",
            side: "top"
          }
        },
        {
            element: '#new-chat-button',
            popover: {
              title: '6. Start a New Chat',
              description: "Click here at any time to start a fresh conversation. This will clear the current chat and reset all settings, allowing you to choose a new model.",
              side: "bottom"
            }
        },
        {
          element: '#generator-nav-link',
          popover: {
            title: 'The Direct Generator',
            description: "This section lets you generate images directly, without the agent's help. It's faster for simple ideas. <b>Click 'Generator' to continue the tour.</b>",
            side: "right",
            showButtons: ['close'],
          }
        },
        {
          element: '#generator-prompt-card',
          popover: {
            title: 'Describe Your Image',
            description: "In the direct generator, the **Prompt** is what you want to see, and the **Negative Prompt** is what you want to avoid. Be as descriptive as possible!",
            side: "bottom"
          }
        },
        {
            element: '#generator-settings-card',
            popover: {
              title: 'Configure the Details',
              description: "Here you have direct control. Manually select your model, aspect ratio, and other technical details without agent assistance. You can also enable the **Two-Stage Refinement** pipeline here for higher quality.",
              side: "top"
            }
        },
        {
          element: '#gallery-nav-link',
          popover: {
            title: 'Your Gallery',
            description: "All your creations are saved here, ready to be viewed and downloaded. <b>Click 'Gallery' to continue.</b>",
            side: "right",
            showButtons: ['close'],
          }
        },
        {
          element: '#gallery-tabs',
          popover: {
            title: 'Filter Your Results',
            description: "You can view all your images or filter to see only those created by the agent or those from the direct generator.",
            side: "bottom"
          }
        },
        {
          element: '#chat-nav-link',
          popover: {
            title: 'Tour Complete!',
            description: "You're ready to create! You can restart this tour any time from the sidebar. <b>Click 'Agent Chat' to finish.</b>",
            side: "right",
            showButtons: ['close'],
          }
        }
      ]
    });

    driverRef.current = driverObj;

    if (location.pathname !== '/chat') {
      navigate('/chat');
      setTimeout(() => driverObj.drive(), 500);
    } else {
      driverObj.drive();
    }
  }, [tourRequestCount, hasCompletedTour, navigate, supabase, location.pathname]);

  // Effect to advance the tour when the page location changes
  useEffect(() => {
    if (!isTourActive.current || !driverRef.current) return;

    const driverObj = driverRef.current;
    const activeStep = driverObj.getActiveStep();
    if (!activeStep || !activeStep.element) return;

    const activeElementId = typeof activeStep.element === 'string' ? activeStep.element.substring(1) : '';
    
    const navigationMap: Record<string, string> = {
      'generator-nav-link': '/generator',
      'gallery-nav-link': '/gallery',
      'chat-nav-link': '/chat',
    };

    if (navigationMap[activeElementId] === location.pathname) {
      driverObj.moveNext();
    }
    
    if (activeElementId === 'chat-nav-link' && location.pathname === '/chat') {
        driverObj.destroy();
    }

  }, [location.pathname]);

  return null;
};