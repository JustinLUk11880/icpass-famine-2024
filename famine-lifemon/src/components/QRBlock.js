import { useState } from 'react';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import { FormGroup, FormControlLabel, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import Scanner from './Scanner';

const theme = createTheme({ typography: { fontFamily: 'Ubuntu' } });

export default function QRBlock({ groupId }) {
	const [checked, setChecked] = useState(false);
	return (
		<ThemeProvider theme={theme}>
			<Stack spacing={2}>
				<FormGroup>
					<FormControlLabel
						control={<Switch checked={checked} onChange={() => setChecked(!checked)} />}
						label={<Typography fontWeight='bold'>TOGGLE SCANNER</Typography>}
					/>
				</FormGroup>
				{checked && <Scanner setChecked={setChecked} groupId={groupId} />}
			</Stack>
		</ThemeProvider>
	);
}
