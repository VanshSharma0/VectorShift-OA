import { useState, useEffect } from 'react';
import {
    Box,
    Button,
    CircularProgress,
    List,
    ListItem,
    ListItemText,
    Typography,
    Collapse,
    Paper
} from '@mui/material';
import { ChevronRight, ChevronDown } from 'lucide-react';
import axios from 'axios';

export const HubspotIntegration = ({ user, org, integrationParams, setIntegrationParams }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [items, setItems] = useState([]);
    const [expandedItems, setExpandedItems] = useState({});
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleConnectClick = async () => {
        try {
            setIsConnecting(true);
            setError(null);
            const formData = new FormData();
            formData.append('user_id', user);
            formData.append('org_id', org);
            const response = await axios.post('http://localhost:8000/integrations/hubspot/authorize', formData);
            const authURL = response?.data;

            const newWindow = window.open(authURL, 'HubSpot Authorization', 'width=600,height=600');
            const pollTimer = window.setInterval(() => {
                if (newWindow?.closed !== false) {
                    window.clearInterval(pollTimer);
                    handleWindowClosed();
                }
            }, 200);
        } catch (e) {
            setIsConnecting(false);
            setError(e?.response?.data?.detail || 'Failed to connect to HubSpot');
        }
    };

    const handleWindowClosed = async () => {
        try {
            const formData = new FormData();
            formData.append('user_id', user);
            formData.append('org_id', org);
            const response = await axios.post('http://localhost:8000/integrations/hubspot/credentials', formData);
            const credentials = response.data;

            if (credentials) {
                setIsConnected(true);
                setIntegrationParams(prev => ({ ...prev, credentials: credentials, type: 'Hubspot' }));
                await fetchItems(credentials);
            }
        } catch (e) {
            setError(e?.response?.data?.detail || 'Failed to get credentials');
        } finally {
            setIsConnecting(false);
        }
    };

    const fetchItems = async (credentials) => {
        setIsLoading(true);
        try {
            const response = await axios.post(
                'http://localhost:8000/integrations/hubspot/items',
                { credentials }
            );
            
            if (Array.isArray(response.data)) {
                setItems(response.data);
            }
        } catch (error) {
            // console.error('Error fetching HubSpot items:', error);
            setError('Failed to fetch HubSpot items');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleItem = (itemId) => {
        setExpandedItems(prev => ({
            ...prev,
            [itemId]: !prev[itemId]
        }));
    };

    const renderItem = (item) => {
        const childItems = items.filter(i => i.parent_id === item.id);
        const hasChildren = childItems.length > 0;

        return (
            <Box key={item.id} sx={{ mb: 1 }}>
                <ListItem
                    button={hasChildren}
                    onClick={hasChildren ? () => toggleItem(item.id) : undefined}
                    sx={{
                        bgcolor: 'grey.100',
                        borderRadius: 1,
                        mb: 0.5,
                        pl: item.parent_id ? 4 : 2
                    }}
                >
                    {hasChildren && (
                        expandedItems[item.id] ? 
                            <ChevronDown className="mr-2" size={20} /> : 
                            <ChevronRight className="mr-2" size={20} />
                    )}
                    <ListItemText
                        primary={item.name}
                        secondary={item.type}
                    />
                </ListItem>
                {hasChildren && (
                    <Collapse in={expandedItems[item.id]} timeout="auto">
                        <List component="div" disablePadding>
                            {childItems.map(renderItem)}
                        </List>
                    </Collapse>
                )}
            </Box>
        );
    };

    useEffect(() => {
        if (integrationParams?.credentials) {
            setIsConnected(true);
            fetchItems(integrationParams.credentials);
        }
    }, []);

    return (
        <Paper elevation={1} sx={{ p: 3, mt: 2 }}>
            <Typography variant="h6" gutterBottom>HubSpot Integration</Typography>
            
            <Box display="flex" alignItems="center" justifyContent="center" sx={{ mb: 3 }}>
                <Button
                    variant="contained"
                    onClick={isConnected ? () => {} : handleConnectClick}
                    color={isConnected ? 'success' : 'primary'}
                    disabled={isConnecting}
                >
                    {isConnected ? 'HubSpot Connected' : 
                     isConnecting ? <CircularProgress size={20} /> : 
                     'Connect to HubSpot'}
                </Button>
            </Box>

            {isLoading && (
                <Box display="flex" justifyContent="center">
                    <CircularProgress />
                </Box>
            )}

            {isConnected && items.length > 0 && !isLoading && (
                <List>
                    {items.filter(item => !item.parent_id).map(renderItem)}
                </List>
            )}

            {isConnected && items.length === 0 && !isLoading && (
                <Typography color="text.secondary" align="center">
                    No HubSpot items found
                </Typography>
            )}
        </Paper>
    );
};

export default HubspotIntegration;