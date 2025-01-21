import { useState, useEffect } from 'react';
import { Box, Button, CircularProgress } from '@mui/material';
import axios from 'axios';

// Environment Variables (Make sure these are correctly set in your .env file)
const HUBSPOT_CLIENT_ID = process.env.REACT_APP_HUBSPOT_CLIENT_ID;
const HUBSPOT_REDIRECT_URI = process.env.REACT_APP_HUBSPOT_REDIRECT_URI;

export const HubspotIntegration = ({ user, org, integrationParams, setIntegrationParams }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    // Function to initiate the HubSpot OAuth process
    const handleConnectClick = async () => {
        try {2
            setIsConnecting(true);

            // Request the authorization URL from the backend
            const response = await axios.post(
                `http://localhost:8000/integrations/hubspot/authorize`,
                { user_id: user, org_id: org }
            );
            const authURL = response?.data?.url;

            if (!authURL) {
                throw new Error("Failed to retrieve authorization URL.");
            }

            // Open the OAuth window
            const newWindow = window.open(authURL, 'HubSpot Authorization', 'width=600, height=600');

            // Poll for the OAuth window to close
            const pollTimer = setInterval(() => {
                if (newWindow?.closed !== false) {
                    clearInterval(pollTimer);
                    handleWindowClosed();
                }
            }, 500);
        } catch (error) {
            setIsConnecting(false);
            alert(error?.response?.data?.detail || "An error occurred while connecting to HubSpot.");
        }
    };

    // Function to handle logic when the OAuth window closes
    const handleWindowClosed = async () => {
        try {
            // Fetch HubSpot credentials after OAuth flow is complete
            const response = await axios.post(
                `http://localhost:8000/integrations/hubspot/credentials`,
                { user_id: user, org_id: org }
            );
            const credentials = response?.data;

            if (credentials) {
                setIsConnected(true);
                setIntegrationParams((prev) => ({
                    ...prev,
                    credentials: credentials,
                    type: 'HubSpot',
                }));
            }
        } catch (error) {
            alert(error?.response?.data?.detail || "Failed to retrieve HubSpot credentials.");
        } finally {
            setIsConnecting(false);
        }
    };

    // Update connection status when `integrationParams` changes
    useEffect(() => {
        setIsConnected(!!integrationParams?.credentials);
    }, [integrationParams]);

    return (
        <Box sx={{ mt: 2 }}>
            <Box display="flex" alignItems="center" justifyContent="center" sx={{ mt: 2 }}>
                <Button
                    variant="contained"
                    onClick={isConnected ? null : handleConnectClick}
                    color={isConnected ? 'success' : 'primary'}
                    disabled={isConnecting}
                    style={{
                        pointerEvents: isConnected ? 'none' : 'auto',
                        cursor: isConnected ? 'default' : 'pointer',
                        opacity: isConnected ? 1 : undefined,
                    }}
                >
                    {isConnected ? (
                        'HubSpot Connected'
                    ) : isConnecting ? (
                        <CircularProgress size={20} />
                    ) : (
                        'Connect to HubSpot'
                    )}
                </Button>
            </Box>
        </Box>
    );
};
