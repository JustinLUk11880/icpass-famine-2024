import * as React from 'react';


import Typography from '@mui/material/Typography';
import { Grid, Paper } from '@mui/material';
import { ThemeProvider,createTheme } from '@mui/material/styles';

import { repeatSymbol } from '../utils/display';

export default function Stats({ snapshot, loading, showCharity }) {
	const theme_2 = createTheme({
		typography: {
			fontFamily:'Karla'
		}
	});
	const happySymbol = "😄";
	const foodSymbol = "🍎️";
	const charitySymbol = "🔥";
	const educationMap = ["Primary", "Secondary", "University", "Graduate"];
	return (
		<>
		<ThemeProvider theme = {theme_2}>
			<Paper elevation={6} style={{ background: 'linear-gradient(45deg, #FFE078 10%, #FFC14F 100%)' }} >
				<Grid container spacing={0.5} fontSize={16} style={{ justifyContent: "flex-end", alignItems: "center" }}>
					<Grid item xs={12}>
					</Grid>
					<Grid item xs={3}>
						<Typography variant="body2" fontWeight='medium' color="#111A2D"
							fontSize={13}
							>
							Name
						</Typography>
					</Grid>
					<Grid item xs={8}>
						<Typography variant="body2" fontWeight='bold' color="#111A2D" fontSize={14} style={{textTransform: 'uppercase'}} >
							{loading ? "Loading..." : snapshot?.name}
						</Typography>
					</Grid>
					<Grid item xs={3}>
						<Typography variant="body2" fontWeight='medium' color="#111A2D"
							fontSize={13}
							>
							Group
						</Typography>
					</Grid>
					<Grid item xs={8}>
						<Typography variant="body2" fontWeight='bold' color="#111A2D" fontSize={14} style={{textTransform: 'uppercase'}} >
							{loading ? "Loading..." : "Group " + snapshot?.group}
						</Typography>
					</Grid>
					<Grid item xs={3}>
						<Typography variant="body2"fontWeight='medium' color="#111A2D"
							fontSize={13}
							>
							Asset
						</Typography>
					</Grid>
					<Grid item xs={8}>
						<Typography variant="body2" fontWeight='bold' color="#111A2D" fontSize={14}>
							{loading ? "Loading..." : "$" + snapshot?.money}
						</Typography>
					</Grid>
					<Grid item xs={3}>
						<Typography variant="body2"fontWeight='medium' color="#111A2D"
							fontSize={13}
							>
							Food
						</Typography>
					</Grid>
					<Grid item xs={8}>
						<Typography variant="body2">
							{loading ? "Loading..." : repeatSymbol(foodSymbol, (snapshot?.food ?? 0) + (snapshot?.charityFood ?? 0))}
						</Typography>
					</Grid>
					<Grid item xs={3}>
						<Typography variant="body2"fontWeight='medium' color="#111A2D"
							fontSize={13}
							>
							Happiness
						</Typography>
					</Grid>
					<Grid item xs={8}>
						<Typography variant="body2">
							{loading ? "Loading..." : repeatSymbol(happySymbol, snapshot?.happiness)}
						</Typography>
					</Grid>
					<Grid item xs={3}>
						<Typography variant="body2" fontWeight='medium' color="#111A2D"
							fontSize={13} display={loading ? 'none' : showCharity ? 'display' : 'none'}
						>
							Charity
						</Typography>
					</Grid>
					<Grid item xs={8}>
						<Typography variant="body2" display={loading ? 'none' : showCharity ? 'display' : 'none'}>
							{loading ? "Loading..." : repeatSymbol(charitySymbol, snapshot?.charity)}
						</Typography>
					</Grid>
					<Grid item xs={12}>
					</Grid>
				</Grid>
			</Paper>
			<Paper elevation={6}  style={{ background: 'linear-gradient(45deg, #4FB2AA 10%, #3F8F89 100%)' }} >
				<Grid container spacing={0.5} style={{ justifyContent: "flex-end", alignItems: "center" }}>
					<Grid item xs={12}>
					</Grid>
					<Grid item xs={4}>
						<Typography variant="body2" color="#ffffff" fontWeight='light'
							fontSize={13}
							>
							Qualification
						</Typography>
					</Grid>
					<Grid item xs={7}>
						<Typography variant="body2" color="#ffffff" fontWeight='bold' style={{textTransform: 'uppercase'}} >
							{loading ? "Loading..." : (educationMap[snapshot?.education] ?? "Unknown")}
						</Typography>
					</Grid>
					<Grid item xs={4}>
						<Typography variant="body2" color="#ffffff" fontWeight='light'
							fontSize={13}
						>	
							Marital status
						</Typography>
					</Grid>
					<Grid item xs={7}>
						<Typography variant="body2" color="#ffffff" fontWeight='bold'>
							{loading ? "Loading..." : snapshot?.married ? "MARRIED" : "SINGLE"}
						</Typography>
					</Grid>
					<Grid item xs={12}>
					</Grid>
				</Grid>
			</Paper>
		</ThemeProvider>
		</>
	);
}
