
import React from 'react';
import { Tile, TileColor } from '../types';

interface TileComponentProps {
  tile: Tile;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const TileComponent: React.FC<TileComponentProps> = ({ 
  tile, 
  onClick, 
  selected, 
  disabled,
  size = 'md'
}) => {
  const getColorClass = () => {
    switch (tile.color) {
      case TileColor.Red: return 'text-red-600';
      case TileColor.Blue: return 'text-blue-600';
      case TileColor.Orange: return 'text-orange-500';
      case TileColor.Black: return 'text-slate-900';
      case TileColor.Joker: return 'text-pink-600';
      default: return 'text-gray-800';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'xs': return 'w-6 h-8 text-xs';
      case 'sm': return 'w-8 h-10 text-base md:w-9 md:h-12';
      case 'lg': return 'w-12 h-16 text-2xl md:w-14 md:h-20 md:text-3xl';
      default: return 'w-9 h-12 text-lg md:w-10 md:h-14 md:text-xl';
    }
  };

  return (
    <div
      onClick={!disabled ? onClick : undefined}
      className={`
        ${getSizeClasses()}
        ${getColorClass()}
        ${selected ? 'ring-2 md:ring-4 ring-yellow-400 -translate-y-1' : 'hover:-translate-y-0.5'}
        ${disabled ? 'opacity-80 cursor-default' : 'cursor-pointer active:scale-95'}
        bg-white rounded-md border-b-2 md:border-b-4 border-gray-300 flex items-center justify-center font-bold 
        select-none transition-all duration-200 tile-shadow m-0.5 flex-shrink-0
      `}
    >
      {tile.isJoker ? (
        <span className="text-xl md:text-2xl">☺</span>
      ) : (
        tile.number
      )}
    </div>
  );
};

export default TileComponent;
