import React from 'react';
import { useParams } from 'react-router-dom';
import GroupPage from '../components/group/GroupPage';

const GroupPageRoute: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  return <GroupPage groupName={name ?? ''} />;
};

export default GroupPageRoute;
