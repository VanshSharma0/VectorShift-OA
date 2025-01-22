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
    Alert
} from '@mui/material';
import { ChevronRight, ChevronDown } from 'lucide-react';
import axios from 'axios';
import axiosInstance from './axiosConfig';
axios.defaults.withCredentials = true;


export const AirtableIntegration = ({ user, org, integrationParams, setIntegrationParams }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [bases, setBases] = useState([]);
    const [expandedBases, setExpandedBases] = useState({});
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleConnectClick = async () => {
        try {
            setIsConnecting(true);
            setError(null);
            const formData = new FormData();
            formData.append('user_id', user);
            formData.append('org_id', org);
            const response = await axios.post(
                `http://localhost:8000/integrations/airtable/authorize`, 
                formData,
                {
                    withCredentials: true,
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    }
                }
            );
            const authURL = response?.data;

            const newWindow = window.open(authURL, 'Airtable Authorization', 'width=600, height=600');

            const pollTimer = window.setInterval(() => {
                if (newWindow?.closed !== false) {
                    window.clearInterval(pollTimer);
                    handleWindowClosed();
                }
            }, 200);
        } catch (e) {
            setIsConnecting(false);
            setError(e?.response?.data?.detail || 'Failed to connect to Airtable');
        }
    };

    const handleWindowClosed = async () => {
        try {
            setError(null);
            const formData = new FormData();
            formData.append('user_id', user);
            formData.append('org_id', org);
            const response = await axios.post(
                `http://localhost:8000/integrations/airtable/credentials`, 
                formData,
                {
                    withCredentials: true,
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    }
                }
            );
            const credentials = response.data;

            if (credentials) {
                setIsConnected(true);
                setIntegrationParams(prev => ({ ...prev, credentials: credentials, type: 'Airtable' }));
                await fetchBases(credentials);
            }
        } catch (e) {
            setError(e?.response?.data?.detail || 'Failed to get credentials');
        } finally {
            setIsConnecting(false);
        }
    };

    const fetchBases = async (credentials) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await axiosInstance.post(
                '/integrations/airtable/items',
                { credentials: credentials }
            );
            
            if (Array.isArray(response.data)) {
                // Process the data
                const processedData = response.data.reduce((acc, item) => {
                    if (item.type === 'Base') {
                        // Create base entry
                        acc[item.id] = {
                            id: item.id,
                            name: item.name,
                            type: item.type,
                            tables: []
                        };
                    } else if (item.type === 'Table') {
                        // Add table to its base
                        const baseId = item.parent_id;
                        if (acc[baseId]) {
                            acc[baseId].tables.push({
                                id: item.id,
                                name: item.name,
                                type: item.type,
                                parent_path_or_name: item.parent_path_or_name
                            });
                        }
                    }
                    return acc;
                }, {});

                setBases(Object.values(processedData));
            } else {
                setError('Invalid data format received from server');
            }
        } catch (error) {
            console.error('Error fetching bases:', error);
            setError('Failed to fetch Airtable bases');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleBase = (baseId) => {
        setExpandedBases(prev => ({
            ...prev,
            [baseId]: !prev[baseId]
        }));
    };

    useEffect(() => {
        if (integrationParams?.credentials) {
            setIsConnected(true);
            fetchBases(integrationParams.credentials);
        }
    }, []);

    return (
        <Box sx={{ mt: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Airtable Integration</Typography>
            
            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
            )}

            <Box display="flex" alignItems="center" justifyContent="center" sx={{ mb: 3 }}>
                <Button
                    variant="contained"
                    onClick={isConnected ? () => {} : handleConnectClick}
                    color={isConnected ? 'success' : 'primary'}
                    disabled={isConnecting}
                    style={{
                        pointerEvents: isConnected ? 'none' : 'auto',
                        cursor: isConnected ? 'default' : 'pointer',
                        opacity: isConnected ? 1 : undefined
                    }}
                >
                    {isConnected ? 'Airtable Connected' : isConnecting ? <CircularProgress size={20} /> : 'Connect to Airtable'}
                </Button>
            </Box>

            {isLoading && (
                <Box display="flex" justifyContent="center">
                    <CircularProgress />
                </Box>
            )}

            {isConnected && bases.length > 0 && !isLoading && (
                <List sx={{ width: '100%', bgcolor: 'background.paper' }}>
                    {bases.map((base) => (
                        <Box key={base.id} sx={{ mb: 1 }}>
                            <ListItem
                                button
                                onClick={() => toggleBase(base.id)}
                                sx={{ 
                                    bgcolor: 'grey.100',
                                    borderRadius: 1,
                                    mb: 0.5
                                }}
                            >
                                {expandedBases[base.id] ? 
                                    <ChevronDown className="mr-2" size={20} /> : 
                                    <ChevronRight className="mr-2" size={20} />
                                }
                                <ListItemText 
                                    primary={base.name}
                                    secondary={`${base.tables?.length || 0} tables`}
                                />
                            </ListItem>
                            <Collapse in={expandedBases[base.id]} timeout="auto">
                                <List component="div" disablePadding>
                                    {base.tables?.map((table) => (
                                        <ListItem 
                                            key={table.id}
                                            sx={{ pl: 4 }}
                                        >
                                            <ListItemText 
                                                primary={table.name}
                                                secondary={`Base: ${table.parent_path_or_name}`}
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            </Collapse>
                        </Box>
                    ))}
                </List>
            )}

            {isConnected && bases.length === 0 && !isLoading && (
                <Typography color="text.secondary" align="center">
                    No Airtable bases found
                </Typography>
            )}
        </Box>
    );
};

export default AirtableIntegration;