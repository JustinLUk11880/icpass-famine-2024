import React, { useState } from 'react'

import LocationRenderer from './LocationRenderer';
import { UniversityLevel } from './School';

const PoliceStationPrison = ({ setFormData }) => {
  const [type, setType] = useState(-1);
  const [amount, setAmount] = useState(-1);

  const roles = ['Police', 'Prisoner'];
  const PoliceID = roles.indexOf('Police');
  const PrisonerID = roles.indexOf('Prisoner');

  const prisonerOutcomes = [
    { name: 'Betray Win', amount: 100 },
    { name: 'Betray Lose', amount: -200 },
    { name: 'Loyal Win', amount: -50 },
    { name: 'Loyal Lose', amount: -150 },
  ];

  const handleRoleChange = e => {
    const value = Number(e.target.value);
    setType(value);
    setAmount(0);

    if (value === PoliceID) {
      setFormData({
        food: -1,
        happiness: -1,
        money: 150, // default when 0 criminals caught
        education: { requirement: UniversityLevel }, // requested education requirement
      });
    } else if (value === PrisonerID) {
      setFormData({});
    }
  }

  const handlePoliceAmount = e => {
    const value = Number(e.target.value);
    setAmount(value);
    setFormData({
      food: -1,
      happiness: -1,
      money: 150 + value * 100,
      education: { requirement: UniversityLevel },
    });
  }

  const handlePrisonerAmount = e => {
    const value = e.target.value;
    setAmount(value);
    setFormData({});
  }

  const controls = [
    {
      id: 'type-select',
      label: 'Role',
      value: type,
      onChange: handleRoleChange,
      select: true,
      options: roles.map((r, i) => ({ value: i, label: r })),
      sx: { width: '20em' },
      required: true,
    },
    type === PoliceID ? {
      id: 'amount-select',
      label: 'Caught Criminals',
      value: amount,
      onChange: handlePoliceAmount,
      select: true,
      options: ([...Array(6).keys()]).map(i => ({ value: i, label: String(i) })),
      sx: { width: '20em' },
      required: true,
    } : 
    type === PrisonerID ? {
      id: 'amount-select',
      label: 'outcome',
      value: amount,
      onChange: handlePrisonerAmount,
      select: true,
      options: prisonerOutcomes.map((o, i) => ({ value: o.amount, label: o.name })),
      sx: { width: '20em' },
      required: true,
    } : null
  ].filter(Boolean);

  return <LocationRenderer controls={controls} />
}
export default PoliceStationPrison;
