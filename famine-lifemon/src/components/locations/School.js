import React, { useState, useEffect } from 'react'

import LocationRenderer from './LocationRenderer';
import { useCallback } from 'react';

const PrimaryLevel = 0;
const SecondaryLevel = 1;
const UniversityLevel = 2;
const GraduateLevel = 3;

// TODO: unify with similar hooks in other locations
// TODO: abstract common patterns(useXOption) into reusable hooks/components

function useGraduationOption(setFormData) {
  const levels = ['Primary', 'Secondary', 'University'];

  const [education, setEducation] = useState(0);
  const [graduated, setGraduated] = useState(false);
  // school option
  const getGraduationForm = useCallback((level = education, passing = graduated) => {
    return {
      food: -level - 1,
      happiness: -1,
      education: { requirement: level, pass: Number(passing) },
    };
  }, [education, graduated]);

  // keep parent form in sync whenever internal state changes
  useEffect(() => {
    setFormData(getGraduationForm());
  }, [education, graduated, getGraduationForm, setFormData]);

  const handleEducationChange = e => {
    const level = Number(e.target.value);
    setEducation(level);
  };

  const handleGraduatedChange = e => {
    const passed = e.target.value === 'true' || e.target.value === true;
    setGraduated(Boolean(passed));
  };

  const controls = [
    {
      id: 'education-level-select',
      label: 'Level',
      value: education,
      onChange: handleEducationChange,
      select: true,
      options: levels.map((level, index) => ({ value: index, label: level })),
      sx: { width: '20em' },
      required: true,
    },
    {
      id: 'result-select',
      label: 'Result',
      value: graduated,
      onChange: handleGraduatedChange,
      select: true,
      options: [{ value: true, label: 'Pass' }, { value: false, label: 'Fail' }],
      sx: { width: '20em' },
      required: true,
    },
  ];

  // allow top-level to set defaults programmatically
  const setDefaults = ({ level = 0, pass = false } = {}) => {
    setEducation(level);
    setGraduated(Boolean(pass));
    // setFormData will be triggered by the effect above
  };

  return { getForm: () => getGraduationForm(), controls, setDefaults };
}

function useTeachingOption(setFormData) {
  // TODO: align difficulty with level payouts
  const difficulty = ['中一/二', '中三', '中四', '中五'];
  const [teachingLevel, setTeachingLevel] = useState(1);

  const getTeachingForm = useCallback((level = teachingLevel) => {
    const levelPayouts = { 1: 50, 2: 100, 3: 150, 4: 200 };
    return {
      food: -1,
      happiness: -1,
      money: levelPayouts[level] ?? 0,
      education: { requirement: UniversityLevel },
    };
  }, [teachingLevel]);

  useEffect(() => {
    setFormData(getTeachingForm());
  }, [teachingLevel, getTeachingForm, setFormData]);

  const handleTeacherLevel = e => {
    const value = Number(e.target.value);
    setTeachingLevel(value);
  };

  const controls = [
    {
      id: 'teacher-level-select',
      label: 'Level reached',
      value: teachingLevel,
      onChange: handleTeacherLevel,
      select: true,
      options: difficulty.map((level, index) => ({ value: index + 1, label: level })),
      sx: { width: '20em' },
      required: true,
    },
  ];

  const setDefaults = ({ level = 1 } = {}) => {
    setTeachingLevel(level);
  };

  return { getForm: () => getTeachingForm(), controls, setDefaults };
}

/* ---------- Top-level component ---------- */
const School = ({ setFormData }) => {
  const roles = ['School', 'Teacher'];
  const SchoolRoleID = roles.indexOf('School');

  const [type, setType] = useState(SchoolRoleID);

  // instantiate sub-option hooks
  const graduation = useGraduationOption(setFormData);
  const teaching = useTeachingOption(setFormData);

  // When top-level switches type, ensure the selected sub-option's current form is pushed
  useEffect(() => {
    if (type === SchoolRoleID) {
      // optionally set defaults when switching; example defaults shown
      // graduation.setDefaults({ level: PrimaryLevel, pass: false });
      setFormData(graduation.getForm());
    } else {
      // teaching.setDefaults({ level: 1 });
      setFormData(teaching.getForm());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]); // intentionally only depend on type; sub-hooks manage their own state

  const handleTypeChange = e => {
    const value = Number(e.target.value);
    setType(value);
    // the effect above will call setFormData for the newly selected sub-option
  };

  const typeControl = {
    id: 'type-select',
    label: 'Type',
    value: type,
    onChange: handleTypeChange,
    select: true,
    options: roles.map((role, index) => ({ value: index, label: role })),
    sx: { width: '20em' },
    required: true,
  };

  // choose controls from the selected sub-option
  const subControls = type === SchoolRoleID ? graduation.controls : teaching.controls;

  const controls = [typeControl, ...subControls];

  return <LocationRenderer controls={controls} />;
};
export default School;

export { PrimaryLevel, SecondaryLevel, UniversityLevel, GraduateLevel };
