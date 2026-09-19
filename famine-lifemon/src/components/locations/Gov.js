import React, { useState } from 'react'

import LocationRenderer from './LocationRenderer';

const Government = ({ setFormData }) => {
  const [type, setType] = useState(-1);
  const [password, setPassword] = useState('');
  const [result, setResult] = useState(-1);

  const roles = ['Stimulus'];


  const handleTypeChange = e => {
    const value = Number(e.target.value);
    setType(value);
    // set invalid value initally
    setResult(0);
    setFormData({});
  }

  const handlePasswordChange = e => {
    const value = e.target.value;
    setPassword(value);
  }

  const handleResultChange = e => {
    const value = Number(e.target.value);
    setResult(value);
    setFormData({
      money: value,
      password: password,
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
      id: 'password-input',
      label: 'Password',
      value: password,
      onChange: handlePasswordChange,
      type: 'password',
      sx: { width: '20em' },
      required: true,
    },
    {
      id: 'result-select',
      label: 'Result',
      value: result,
      onChange: handleResultChange,
      select: false,
      sx: { width: '20em' },
      required: true,
      type: 'number',
      inputProps: { min: -5000, max: 5000 },
    }
  ];

  return <LocationRenderer controls={controls} />
}

export default Government;
