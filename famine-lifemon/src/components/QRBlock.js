import { useState } from 'react';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import { Alert, FormGroup, FormControlLabel, Slide, Snackbar, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import Scanner from './Scanner';

const theme = createTheme({ typography: { fontFamily: 'Ubuntu' } });

export default function QRBlock({ groupId }) {
	const [checked, setChecked] = useState(false);
	const [toast, setToast] = useState({ open: false, severity: 'info', message: '' });

	const notify = (severity, message) => setToast({ open: true, severity, message });
	const close = (_, reason) => {
		if (reason === 'clickaway') return;
		setToast((t) => ({ ...t, open: false }));
	};

	return (
		<ThemeProvider theme={theme}>
			<Stack spacing={2}>
				<FormGroup>
					<FormControlLabel
						control={<Switch checked={checked} onChange={() => setChecked(!checked)} />}
						label={<Typography fontWeight="bold">TOGGLE SCANNER</Typography>}
					/>
				</FormGroup>
				{checked && <Scanner setChecked={setChecked} groupId={groupId} notify={notify} />}
			</Stack>
			<Snackbar
				open={toast.open}
				autoHideDuration={toast.severity === 'success' ? 4000 : 6000}
				onClose={close}
				TransitionComponent={Slide}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
			>
				<Alert severity={toast.severity} onClose={close} variant="filled" sx={{ width: '100%' }}>
					{toast.message}
				</Alert>
			</Snackbar>
		</ThemeProvider>
	);
}
