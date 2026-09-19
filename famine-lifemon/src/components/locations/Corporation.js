import React, { useState } from 'react'

import LocationRenderer from './LocationRenderer';
import { GraduateLevel } from './School';

const Corporation = ({ setFormData }) => {
  const [type, setType] = useState(-1);
  const [result, setResult] = useState(-1);

  const roles = ['Banker', 'Lawyer'];
  const BankerID = roles.indexOf('Banker');
  const LawyerID = roles.indexOf('Lawyer');

  const results = ['Winner', 'Loser'];
  const WinnerID = results.indexOf('Winner');

  const handleTypeChange = e => {
    const value = Number(e.target.value);
    setType(value);
    // set invalid value initally
    setResult(-1);
    setFormData({
      food: -1,
      happiness: -1,
      money: value === BankerID ? 250 : (value === LawyerID ? 220 : 150),
      education: {
        requirement: GraduateLevel,
      },
    });
  }

  const handleResultChange = e => {
    const value = Number(e.target.value);
    setResult(value);
    setFormData({
      food: -1,
      happiness: -1,
      money: value === WinnerID ? 350 : 50,
      education: {
        requirement: GraduateLevel,
      },
    });
  }

  const controls = [
    {
      id: 'type-select',
      label: 'Type',
      value: type,
      onChange: handleTypeChange,
      select: true,
      options: roles.map((r, i) => ({ value: i, label: r })),
      sx: { width: '20em' },
      required: true,
    },
    {
      id: 'result-select',
      label: 'Result',
      value: result,
      onChange: handleResultChange,
      select: true,
      options: results.map((r, i) => ({ value: i, label: r })),
      sx: { width: '20em' },
      required: true,
    }
  ];

  return <LocationRenderer controls={controls} />
}

export default Corporation;
